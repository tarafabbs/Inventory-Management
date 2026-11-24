import {db} from '@/lib/database';
import {inventorySession, type InventoryUser} from '@/lib/inventory-identity';
import {canEditOfficeEntry, isManagement, isOfficeRole, permitted, roleLabel} from '@/lib/rules';
import {
  isOfficeOperation, issueEditWindow, maxStockQuantity, needsDisputeReason, officeOperations,
  ownsOfficeTransfer, stockHistoryPageSize, stockOperations, trackedArtisan,
  type StockOperation, type StockSnapshot,
} from '@/lib/quantity-stock';

export const dynamic = 'force-dynamic';

const respond = (data: unknown, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});
class StockError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function failed(error: unknown) {
  if (error instanceof StockError) return respond({error: error.message}, error.status);
  console.error('Quantity stock request failed', error instanceof Error ? error.name : 'unknown');
  return respond({error: 'The stock ledger could not be reached. Please try again.'}, 503);
}

async function stockUser() {
  const {signedIn,staff} = await inventorySession();
  if (!signedIn) throw new StockError('Sign in with Google to view your stock.', 401);
  if (!staff || !permitted(staff.role, 'read')) {
    throw new StockError('This Google email has no active staff access.', 403);
  }
  return staff;
}

const officeStockStages = "('office_pending','office_vendor_pending','office_stock','office_sold','factory_return_pending')";
const officeHistoryKinds = '(' + [...officeOperations,'send_office','receive_factory_return'].map(kind => "'" + kind + "'").join(',') + ')';
const legacyOfficeTransactions = "('OFFICE_SEND','OFFICE_RECEIVE','OFFICE_LABEL_CONFIRM','OFFICE_SALE','OFFICE_DISPUTE_RETURN','CUSTOMER_DISPUTE_RETURN','FACTORY_DISPUTE_RECEIVE','OFFICE_ENTRY_EDIT','OFFICE_MASTER_EDIT')";
async function snapshot(user: InventoryUser, companyId: string, offset: number, office: boolean, artisanId=''): Promise<StockSnapshot> {
  const movementScope = office ? `m.kind IN ${officeHistoryKinds}` : `(m.kind NOT IN ${officeHistoryKinds} OR m.kind IN ('send_office','receive_factory_return'))`;
  const legacyTxScope = office ? `t.type IN ${legacyOfficeTransactions}`
    : `p.journey='WORKSHOP' AND (t.type NOT IN ${legacyOfficeTransactions} OR t.type IN ('OFFICE_SEND','FACTORY_DISPUTE_RECEIVE')) AND t.type<>'INTAKE'`;
  const companyScope = office ? "(c.office_only=1 OR c.ownership='OWN')" : 'c.office_only=0';
  const productScope = office ? `p.office_only=1 OR EXISTS (SELECT 1 FROM scoped_balances b WHERE b.product_id=p.id)
    OR EXISTS (SELECT 1 FROM history h WHERE h.product_id=p.id)` : 'p.office_only=0';
  const balanceScope = office ? `b.stage IN ${officeStockStages}` : '(c.office_only=0 AND p.office_only=0)';
  const row = await db.prepare(`
    WITH scoped_balances AS (
      SELECT b.* FROM inventory.quantity_balances b JOIN companies c ON c.id=b.company_id JOIN products p ON p.id=b.product_id
      WHERE b.quantity<>0 AND ${balanceScope}
    ), all_history AS (
      SELECT m.id::text, m.company_id, m.product_id, m.artisan_id, m.kind,
        m.quantity + coalesce((SELECT sum(e.quantity) FROM inventory.quantity_movements e WHERE e.original_id=m.id),0) AS quantity,
        m.quantity AS original_quantity, m.previous_quantity, m.new_quantity, m.created_at,
        m.reference, m.notes, m.actor, m.actor_id, m.received_on, m.actor_role, m.preferred_work
      FROM inventory.quantity_movements m WHERE ${movementScope} AND (?::text = '' OR m.company_id=?)
      UNION ALL
      SELECT l.id,l.company_id,l.product_id,NULL::text,'legacy',l.accepted,l.accepted,NULL,NULL,
        l.created_at::timestamptz,l.reference,'Receipt · ' || l.number,l.actor,NULL,nullif(left(l.received_at,10),'')::date,NULL,''
      FROM lots l WHERE l.journey=${office ? "'OFFICE'" : "'WORKSHOP'"} AND l.status<>'DRAFT' AND (?::text = '' OR l.company_id=?)
      UNION ALL
      SELECT t.id || ':' || p.company_id || ':' || p.product_id,p.company_id,p.product_id,t.artisan_id,'legacy',
        count(*),count(*),NULL,NULL,t.created_at::timestamptz,'',
        initcap(replace(t.type,'_',' ')) || ' · ' || t.number || CASE WHEN t.status='VOIDED_BY_REVERSAL' THEN ' (reversed)' ELSE '' END,t.actor,t.created_by,NULL,NULL,''
      FROM transactions t JOIN transaction_items i ON i.transaction_id=t.id JOIN pieces p ON p.id=i.piece_id
      WHERE ${legacyTxScope} AND t.status IN ('CONFIRMED','VOIDED_BY_REVERSAL')
        AND (?::text = '' OR p.company_id=?)
      GROUP BY t.id,p.company_id,p.product_id
      ${office ? `UNION ALL
        SELECT a.id::text,m.company_id,m.product_id,NULL,'office_entry_edit',
          m.quantity,m.quantity,NULL,NULL,a.created_at,a.after_data->>'reference',a.after_data->>'reason',
          a.actor,a.actor_id,(a.after_data->>'received_on')::date,a.actor_role,''
        FROM inventory.change_audit a JOIN inventory.quantity_movements m ON m.id::text=a.target_label
        WHERE a.action='office_entry_edit' AND (?::text = '' OR m.company_id=?)` : ''}
    ), history AS (
      SELECT * FROM all_history WHERE (?::text='' OR artisan_id=?)
      ORDER BY created_at DESC,id DESC
      LIMIT ? OFFSET ?
    )
    SELECT
      coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id',c.id,'name',c.name,'active',c.active,'ownership',c.ownership,'office_only',c.office_only,
        'contact',c.contact,'address',c.address,'notes',c.notes
      ) ORDER BY c.name) FROM companies c WHERE ${companyScope}),'[]') AS companies,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'active',p.active,'office_only',p.office_only) ORDER BY p.name) FROM products p WHERE ${productScope}),'[]') AS products,
      ${office ? "'[]'::jsonb" : "coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active,'work_type',work_type) ORDER BY name) FROM artisans),'[]')"} AS artisans,
      ${office ? "'[]'::jsonb" : "coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active) ORDER BY name) FROM thanwalas),'[]')"} AS thanwalas,
      coalesce((SELECT jsonb_agg(b) FROM scoped_balances b),'[]') AS balances,
      ${office ? "'[]'::jsonb" : "coalesce((SELECT jsonb_agg(t) FROM inventory.quantity_totals t),'[]')"} AS totals,
      coalesce((SELECT jsonb_agg(h ORDER BY h.created_at DESC,h.id DESC) FROM history h),'[]') AS history
  `).bind(companyId, companyId, companyId, companyId, companyId, companyId, ...(office ? [companyId,companyId] : []),
    artisanId,artisanId,stockHistoryPageSize + 1, offset)
    .first<Omit<StockSnapshot, 'user' | 'more'>>();
  if (!row) throw new StockError('The stock ledger is unavailable.', 503);
  return {
    ...row, user: {id: user.id, name: user.name, role: user.role},
    more: row.history.length > stockHistoryPageSize, history: row.history.slice(0, stockHistoryPageSize),
  };
}

export async function GET(request: Request) {
  try {
    const user = await stockUser();
    const params = new URL(request.url).searchParams;
    const office = params.get('view') === 'office' || isOfficeRole(user.role);
    if (office && !isOfficeRole(user.role) && !isManagement(user.role)) throw new StockError('This account has no Office access.',403);
    const page = Number(params.get('page') || 0);
    if (!Number.isSafeInteger(page) || page < 0 || page > 10_000) throw new StockError('Choose a valid history page.');
    return respond(await snapshot(user, (params.get('company') || '').slice(0, 100), page * stockHistoryPageSize, office,
      office?'':(params.get('artisan')||'').slice(0,100)));
  } catch (error) {
    return failed(error);
  }
}

type StockTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Entry = {
  company_id: string; product_id: string; artisan_id: string | null; actor_id: string;
  created_at: Date; quantity: number; effective_quantity: number;
};

function value(input: unknown, limit = 100) {
  if (typeof input !== 'string') return '';
  if (input.length > limit) throw new StockError(`Keep each field under ${limit + 1} characters.`);
  return input.trim();
}

function requirePermission(user: InventoryUser, permission: string) {
  if (!permitted(user.role, permission)) throw new StockError('Your role cannot save this action.', 403);
}

function amount(input: unknown) {
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 1 || input > maxStockQuantity) {
    throw new StockError('Enter a whole quantity from 1 to 10,00,000 pcs.');
  }
  return input;
}

function arrivalDate(input: unknown) {
  const date = value(input,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
    || new Date(date).toISOString().slice(0,10) !== date) throw new StockError('Enter a valid arrival date.');
  return date;
}

async function available(tx: StockTransaction, company: string, product: string, stage: string, artisan: string | null) {
  const row = await tx.prepare(`
    SELECT quantity FROM inventory.quantity_balances WHERE company_id=? AND product_id=? AND stage=?
      AND artisan_id IS NOT DISTINCT FROM ?::text
  `).bind(company, product, stage, artisan).first<{quantity: string}>();
  return Number(row?.quantity ?? 0);
}

async function lockStock(tx: StockTransaction, company: string, product: string) {
  await tx.prepare('SELECT pg_advisory_xact_lock(hashtext(?),hashtext(?))').bind(company, product).run();
}

async function writeMovement(tx: StockTransaction, user: InventoryUser, body: Record<string, unknown>, kind: StockOperation) {
  const operation = stockOperations[kind];
  const quantity = amount(body.quantity);
  const company = value(body.companyId);
  const product = value(body.productId);
  const artisan = trackedArtisan(operation.from, value(body.artisanId)) || trackedArtisan(operation.to, value(body.artisanId));
  const notes = value(body.notes, 1000);
  const reference = value(body.reference, 200);
  const thanwala = kind === 'receipt' ? value(body.thanwalaId) || null : null;
  const receipt = kind === 'receipt' || kind === 'office_vendor_receipt';
  const receivedOn = receipt ? arrivalDate(body.receivedOn) : null;
  const preferredWork=kind==='receipt'?value(body.preferredWork,300):'';
  if(preferredWork){
    const listed=await tx.prepare("SELECT id FROM artisans WHERE active=1 AND trim(work_type)=? LIMIT 1").bind(preferredWork).first();
    if(!listed)throw new StockError('Choose a preferred work listed for an active artisan.');
  }
  if (!company || !product) throw new StockError('Choose a company and product category.');
  if (needsDisputeReason(kind)) {
    if (!notes) throw new StockError('Enter the dispute reason.');
  }
  if ((trackedArtisan(operation.from, 'required') || trackedArtisan(operation.to, 'required')) && !artisan) {
    throw new StockError('Choose an artisan.');
  }

  await lockStock(tx, company, product);
  const source = await tx.prepare(`
    SELECT c.ownership,c.office_only AS office_company,p.office_only AS office_product,c.active AS company_active,p.active AS product_active,
      (SELECT active FROM artisans WHERE id=?) AS artisan_active,
      EXISTS (SELECT 1 FROM thanwalas WHERE id=? AND active=1) AS valid_thanwala
    FROM companies c CROSS JOIN inventory.products p
    WHERE c.id=? AND p.id=?
  `).bind(artisan, thanwala, company, product)
    .first<{ownership: string; office_company: number; office_product: number; company_active: number; product_active: number; artisan_active: number | null; valid_thanwala: boolean}>();
  if (!source || (receipt && (!source.company_active || !source.product_active))) {
    throw new StockError('Choose an active company and category.');
  }
  const vendor = source.ownership === 'EXTERNAL' && source.office_company === 1 && source.office_product === 1;
  const own = source.ownership === 'OWN' && source.office_company === 0 && source.office_product === 0;
  if (ownsOfficeTransfer(kind) && !own) throw new StockError('Only TaraFabbs Own Products can use this movement.',403);
  if ((kind === 'office_vendor_receipt' || kind === 'office_accept_pending') && !vendor) throw new StockError('Choose an Office vendor and Office category.');
  if (kind === 'office_sell' && !own && !vendor) throw new StockError('Choose an Office stock category.');
  if (!isOfficeOperation(kind) && (source.office_company || source.office_product)) throw new StockError('Choose a workshop company and category.');
  if (artisan && (source.artisan_active === null || ((kind === 'issue' || kind === 'send_repair') && !source.artisan_active))) {
    throw new StockError('Choose an available artisan.');
  }
  if (thanwala && (source.ownership !== 'OWN' || !source.valid_thanwala)) throw new StockError('Choose an active Thanwala for own stock.');
  if (kind === 'receipt' && source.ownership === 'OWN' && !thanwala) throw new StockError('Choose the purchase Thanwala for own stock.');
  if (kind === 'dispatch' && source.ownership !== 'EXTERNAL') throw new StockError('Choose a jobwork company for this delivery.');
  if (operation.from) {
    const balance = await available(tx, company, product, operation.from, trackedArtisan(operation.from, artisan));
    if (quantity > balance) throw new StockError(`Only ${Math.max(0, balance)} pcs are available for this action. Refresh the balance and adjust the quantity.`, 409);
  }
  const row = await tx.prepare(`
    INSERT INTO inventory.quantity_movements
      (company_id,product_id,artisan_id,thanwala_id,kind,from_stage,to_stage,quantity,received_on,reference,notes,actor_id,actor,actor_role,preferred_work)
    VALUES (?,?,?,?,?,?,?,?,?::date,?,?,?,?,?,?) RETURNING id
  `).bind(company, product, artisan || null, thanwala, kind, operation.from, operation.to, quantity,
    receivedOn, reference, notes, user.id, user.name, roleLabel(user.role),preferredWork).first<{id: string}>();
  return {ok: true, id: row?.id};
}

async function editIssue(tx: StockTransaction, user: InventoryUser, body: Record<string, unknown>) {
  const id = value(body.id);
  const quantity = amount(body.quantity);
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new StockError('Choose a saved quantity handoff.');
  const key = await tx.prepare("SELECT company_id,product_id FROM inventory.quantity_movements WHERE id::text=? AND kind='issue'")
    .bind(id).first<Pick<Entry, 'company_id' | 'product_id'>>();
  if (!key) throw new StockError('Handoff was not found.', 404);
  await lockStock(tx, key.company_id, key.product_id);
  const entry = await tx.prepare(`
    SELECT m.company_id,m.product_id,m.artisan_id,m.actor_id,m.created_at,m.quantity,
      (m.quantity + coalesce((SELECT sum(e.quantity) FROM inventory.quantity_movements e WHERE e.original_id=m.id),0))::int AS effective_quantity
    FROM inventory.quantity_movements m WHERE m.id=?::uuid
  `).bind(id).first<Entry>();
  if (!entry || Date.now() - entry.created_at.getTime() >= issueEditWindow) throw new StockError('This handoff’s seven-day edit window has closed.', 409);
  if (!isManagement(user.role) && user.role !== 'Supervisor' && entry.actor_id !== user.id) {
    throw new StockError('You can edit your own handoffs. Ask a supervisor to edit another staff member’s entry.', 403);
  }
  if (entry.effective_quantity !== body.expectedQuantity) throw new StockError('The handoff was edited elsewhere. Reload the history and try again.', 409);
  const delta = quantity - entry.effective_quantity;
  if (!delta) throw new StockError('Enter a different quantity.');
  const stage = delta > 0 ? 'raw' : 'artisan';
  const balance = await available(tx, entry.company_id, entry.product_id, stage, delta > 0 ? null : entry.artisan_id);
  if (Math.abs(delta) > balance) {
    throw new StockError(delta > 0 ? `Only ${Math.max(0,balance)} additional raw pieces are available.`
      : 'This reduction exceeds the outstanding pieces with that artisan. Check the recorded returns.', 409);
  }
  const row = await tx.prepare(`
    INSERT INTO inventory.quantity_movements
      (company_id,product_id,artisan_id,kind,from_stage,to_stage,quantity,original_id,previous_quantity,new_quantity,notes,actor_id,actor,actor_role)
    VALUES (?,?,?,'issue_edit','raw','artisan',?,?::uuid,?,?,?,?,?,?) RETURNING id
  `).bind(entry.company_id, entry.product_id, entry.artisan_id, delta, id, entry.effective_quantity,
    quantity, value(body.notes,1000), user.id, user.name, roleLabel(user.role)).first<{id: string}>();
  return {ok: true, id: row?.id};
}

async function editOfficeEntry(tx:StockTransaction,user:InventoryUser,body:Record<string,unknown>) {
  const id=value(body.id);
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new StockError('Choose an Office entry.');
  const entry=await tx.prepare(`
    SELECT received_on::text,reference,notes,created_at FROM inventory.quantity_movements
    WHERE id::text=? AND kind='office_vendor_receipt' FOR UPDATE
  `).bind(id).first<{received_on:string;reference:string;notes:string;created_at:Date}>();
  if (!entry) throw new StockError('Office entry not found.',404);
  if (!canEditOfficeEntry(user.role,entry.created_at.toISOString())) throw new StockError('The 24-hour Office entry edit window has closed.',403);
  const expected = body.expected as Record<string,unknown> | undefined;
  const before = {received_on:entry.received_on,reference:entry.reference,notes:entry.notes};
  if (!expected || Object.entries(before).some(([field,current])=>current!==expected[field])) {
    throw new StockError('This Office entry changed. Refresh history and try again.',409);
  }
  const after = {received_on:arrivalDate(body.receivedOn),reference:value(body.reference,200),notes:value(body.notes,1000)};
  const reason=value(body.reason,1000);
  if (reason.length<3) throw new StockError('Enter a reason for the correction.');
  if (Object.entries(before).every(([field,current])=>current===after[field as keyof typeof after])) {
    throw new StockError('Change the date, bill reference or notes before saving.');
  }
  await tx.prepare('UPDATE inventory.quantity_movements SET received_on=?::date,reference=?,notes=? WHERE id::text=?')
    .bind(after.received_on,after.reference,after.notes,id).run();
  await tx.prepare(`
    INSERT INTO inventory.change_audit(actor_id,actor,actor_role,action,target_label,before_data,after_data)
    VALUES (?,?,?,'office_entry_edit',?,?::jsonb,?::jsonb)
  `).bind(user.id,user.name,roleLabel(user.role),id,JSON.stringify(before),JSON.stringify({...after,reason})).run();
  return {ok:true,id};
}

async function editCompanyProfile(tx:StockTransaction,user:InventoryUser,body:Record<string,unknown>) {
  if (!isManagement(user.role)) throw new StockError('Only Owner or Management can edit company profiles.',403);
  const id=value(body.id);
  const name=value(body.name,120);
  const contact=value(body.contact,300);
  const address=value(body.address,1000);
  const notes=value(body.notes,2000);
  if (!id || !name) throw new StockError('Enter the company name.');
  const before=await tx.prepare(`
    SELECT id,name,contact,address,notes,active,ownership FROM companies
    WHERE id=? AND office_only=0 FOR UPDATE
  `).bind(id).first<{id:string;name:string;contact:string;address:string;notes:string;active:number;ownership:string}>();
  if (!before) throw new StockError('Company profile not found.',404);
  const expected=body.expected as Record<string,unknown>|undefined;
  if (!expected || ['name','contact','address','notes'].some(field => before[field as keyof typeof before] !== expected[field])) {
    throw new StockError('This company profile changed. Reload and try again.',409);
  }
  const duplicate=await tx.prepare('SELECT id FROM companies WHERE lower(name)=lower(?) AND id<>? LIMIT 1')
    .bind(name,id).first();
  if (duplicate) throw new StockError('Another company already uses this name.',409);
  const after={name,contact,address,notes};
  if (Object.entries(after).every(([field,current]) => current === before[field as keyof typeof before])) {
    throw new StockError('Change at least one company detail before saving.');
  }
  await tx.prepare('UPDATE companies SET name=?,contact=?,address=?,notes=? WHERE id=?')
    .bind(name,contact,address,notes,id).run();
  await tx.prepare(`
    INSERT INTO inventory.change_audit(actor_id,actor,actor_role,action,target_label,before_data,after_data)
    VALUES (?,?,?,'company_profile_edit',?,?::jsonb,?::jsonb)
  `).bind(user.id,user.name,roleLabel(user.role),id,JSON.stringify(before),JSON.stringify({...before,...after})).run();
  return {ok:true,id};
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) throw new StockError('Use the inventory site to save your entry.', 403);
    const user = await stockUser();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new StockError('Enter a valid stock movement.');
    const kind = value(body.kind);
    const key = value(body.key);
    if (!/^[a-f0-9-]{36}$/i.test(key)) throw new StockError('Reload the form and try again.');
    if (!['issue_edit','office_entry_edit','company_profile_edit'].includes(kind) && !Object.hasOwn(stockOperations, kind)) throw new StockError('Choose a stock action.');
    if (isOfficeRole(user.role) && !isOfficeOperation(kind) && kind!=='office_entry_edit') throw new StockError('This account is limited to Office movements.',403);
    requirePermission(user, kind==='issue_edit'?'handoff':kind==='office_entry_edit'?'officeEdit':kind==='company_profile_edit'?'manageData':stockOperations[kind as StockOperation].permission);
    const result = await db.transaction(async tx => {
      const stillActive=await tx.prepare('SELECT id FROM users WHERE id=? AND role=? AND active=1 FOR SHARE').bind(user.id,user.role).first();
      if (!stillActive) throw new StockError('Your access changed. Reload and sign in again.',403);
      const requestKey = `quantity:${key}`;
      await tx.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').bind(requestKey).run();
      const existing = await tx.prepare('SELECT actor,operation,result FROM requests WHERE id=?')
        .bind(requestKey).first<{actor: string; operation: string; result: string}>();
      if (existing) {
        if (existing.actor !== user.id || existing.operation !== kind) throw new StockError('This request has already been used.',409);
        return JSON.parse(existing.result);
      }
      const saved = kind==='issue_edit' ? await editIssue(tx,user,body) : kind==='office_entry_edit'
        ? await editOfficeEntry(tx,user,body) : kind==='company_profile_edit'
          ? await editCompanyProfile(tx,user,body) : await writeMovement(tx,user,body,kind as StockOperation);
      await tx.prepare('INSERT INTO requests(id,actor,operation,result) VALUES (?,?,?,?)')
        .bind(requestKey, user.id, kind, JSON.stringify(saved)).run();
      return saved;
    });
    return respond(result);
  } catch (error) {
    return failed(error);
  }
}
