import {db} from '@/lib/database';
import {inventoryUser, type InventoryUser} from '@/lib/inventory-identity';
import {createClient} from '@/lib/supabase/server';
import {isOfficeRole, permitted} from '@/lib/rules';
import {
  issueEditWindow, maxStockQuantity, stockHistoryPageSize, stockOperations, trackedArtisan,
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

async function workshopUser() {
  const supabase = await createClient();
  const {data: {user: signedIn}} = await supabase.auth.getUser();
  if (!signedIn?.email) throw new StockError('Sign in to view your stock.', 401);
  const user = await inventoryUser(signedIn);
  if (!user?.active || isOfficeRole(user.role) || !permitted(user.role, 'read')) {
    throw new StockError('This stock ledger requires active workshop access.', 403);
  }
  return user;
}

async function snapshot(user: InventoryUser, companyId: string, offset: number): Promise<StockSnapshot> {
  const row = await db.prepare(`
    WITH history AS (
      SELECT m.id::text, m.company_id, m.product_id, m.artisan_id, m.kind,
        m.quantity + coalesce((SELECT sum(e.quantity) FROM inventory.quantity_movements e WHERE e.original_id=m.id),0) AS quantity,
        m.quantity AS original_quantity, m.previous_quantity, m.new_quantity, m.created_at,
        m.reference, m.notes, m.actor, m.actor_id, m.received_on
      FROM inventory.quantity_movements m WHERE (?::text = '' OR m.company_id=?)
      UNION ALL
      SELECT l.id,l.company_id,l.product_id,NULL::text,'legacy',l.accepted,l.accepted,NULL,NULL,
        l.created_at::timestamptz,l.reference,'Receipt · ' || l.number,l.actor,NULL,nullif(left(l.received_at,10),'')::date
      FROM lots l WHERE l.journey='WORKSHOP' AND l.status<>'DRAFT' AND (?::text = '' OR l.company_id=?)
      UNION ALL
      SELECT t.id || ':' || p.company_id || ':' || p.product_id,p.company_id,p.product_id,t.artisan_id,'legacy',
        count(*),count(*),NULL,NULL,t.created_at::timestamptz,'',
        initcap(replace(t.type,'_',' ')) || ' · ' || t.number || CASE WHEN t.status='VOIDED_BY_REVERSAL' THEN ' (reversed)' ELSE '' END,t.actor,t.created_by,NULL
      FROM transactions t JOIN transaction_items i ON i.transaction_id=t.id JOIN pieces p ON p.id=i.piece_id
      WHERE p.journey='WORKSHOP' AND t.status IN ('CONFIRMED','VOIDED_BY_REVERSAL') AND t.type <> 'INTAKE'
        AND (?::text = '' OR p.company_id=?)
      GROUP BY t.id,p.company_id,p.product_id
      ORDER BY created_at DESC,id DESC
      LIMIT ? OFFSET ?
    )
    SELECT
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active,'ownership',ownership) ORDER BY name) FROM companies WHERE office_only=0),'[]') AS companies,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active) ORDER BY name) FROM products WHERE office_only=0),'[]') AS products,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active) ORDER BY name) FROM artisans),'[]') AS artisans,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active) ORDER BY name) FROM thanwalas),'[]') AS thanwalas,
      coalesce((SELECT jsonb_agg(b) FROM inventory.quantity_balances b WHERE b.quantity<>0),'[]') AS balances,
      coalesce((SELECT jsonb_agg(t) FROM inventory.quantity_totals t),'[]') AS totals,
      coalesce((SELECT jsonb_agg(h ORDER BY h.created_at DESC,h.id DESC) FROM history h),'[]') AS history
  `).bind(companyId, companyId, companyId, companyId, companyId, companyId, stockHistoryPageSize + 1, offset)
    .first<Omit<StockSnapshot, 'user' | 'more'>>();
  if (!row) throw new StockError('The stock ledger is unavailable.', 503);
  return {
    ...row, user: {id: user.id, name: user.name, role: user.role},
    more: row.history.length > stockHistoryPageSize, history: row.history.slice(0, stockHistoryPageSize),
  };
}

export async function GET(request: Request) {
  try {
    const user = await workshopUser();
    const params = new URL(request.url).searchParams;
    const page = Number(params.get('page') || 0);
    if (!Number.isSafeInteger(page) || page < 0 || page > 10_000) throw new StockError('Choose a valid history page.');
    return respond(await snapshot(user, (params.get('company') || '').slice(0, 100), page * stockHistoryPageSize));
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
  const receivedOn = kind === 'receipt' ? value(body.receivedOn, 10) : null;
  if (!company || !product) throw new StockError('Choose a company and product category.');
  if (kind === 'receipt' && (!receivedOn || !/^\d{4}-\d{2}-\d{2}$/.test(receivedOn)
    || !Number.isFinite(Date.parse(receivedOn)) || new Date(receivedOn).toISOString().slice(0,10) !== receivedOn)) {
    throw new StockError('Enter a valid arrival date.');
  }
  if (operation.to === 'disputed' || kind === 'dispute_return') {
    if (!notes) throw new StockError('Enter the dispute reason.');
  }
  if ((trackedArtisan(operation.from, 'required') || trackedArtisan(operation.to, 'required')) && !artisan) {
    throw new StockError('Choose an artisan.');
  }

  await lockStock(tx, company, product);
  const source = await tx.prepare(`
    SELECT c.ownership,c.active AS company_active,p.active AS product_active,
      (SELECT active FROM artisans WHERE id=?) AS artisan_active,
      EXISTS (SELECT 1 FROM thanwalas WHERE id=? AND active=1) AS valid_thanwala
    FROM companies c CROSS JOIN inventory.products p
    WHERE c.id=? AND p.id=? AND c.office_only=0 AND p.office_only=0
  `).bind(artisan, thanwala, company, product)
    .first<{ownership: string; company_active: number; product_active: number; artisan_active: number | null; valid_thanwala: boolean}>();
  if (!source || (kind === 'receipt' && (!source.company_active || !source.product_active))) {
    throw new StockError('Choose an active workshop company and category.');
  }
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
      (company_id,product_id,artisan_id,thanwala_id,kind,from_stage,to_stage,quantity,received_on,reference,notes,actor_id,actor)
    VALUES (?,?,?,?,?,?,?,?,?::date,?,?,?,?) RETURNING id
  `).bind(company, product, artisan || null, thanwala, kind, operation.from, operation.to, quantity,
    receivedOn, reference, notes, user.id, user.name).first<{id: string}>();
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
  if (!['Admin','Supervisor'].includes(user.role) && entry.actor_id !== user.id) {
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
      (company_id,product_id,artisan_id,kind,from_stage,to_stage,quantity,original_id,previous_quantity,new_quantity,notes,actor_id,actor)
    VALUES (?,?,?,'issue_edit','raw','artisan',?,?::uuid,?,?,?,?,?) RETURNING id
  `).bind(entry.company_id, entry.product_id, entry.artisan_id, delta, id, entry.effective_quantity,
    quantity, value(body.notes,1000), user.id, user.name).first<{id: string}>();
  return {ok: true, id: row?.id};
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) throw new StockError('Use the inventory site to save your entry.', 403);
    const user = await workshopUser();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new StockError('Enter a valid stock movement.');
    const kind = value(body.kind);
    const key = value(body.key);
    if (!/^[a-f0-9-]{36}$/i.test(key)) throw new StockError('Reload the form and try again.');
    if (kind !== 'issue_edit' && !Object.hasOwn(stockOperations, kind)) throw new StockError('Choose a stock action.');
    requirePermission(user, kind === 'issue_edit' ? 'handoff' : stockOperations[kind as StockOperation].permission);
    const result = await db.transaction(async tx => {
      const requestKey = `quantity:${key}`;
      await tx.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').bind(requestKey).run();
      const existing = await tx.prepare('SELECT actor,operation,result FROM requests WHERE id=?')
        .bind(requestKey).first<{actor: string; operation: string; result: string}>();
      if (existing) {
        if (existing.actor !== user.id || existing.operation !== kind) throw new StockError('This request has already been used.',409);
        return JSON.parse(existing.result);
      }
      const saved = kind === 'issue_edit' ? await editIssue(tx, user, body) : await writeMovement(tx, user, body, kind as StockOperation);
      await tx.prepare('INSERT INTO requests(id,actor,operation,result) VALUES (?,?,?,?)')
        .bind(requestKey, user.id, kind, JSON.stringify(saved)).run();
      return saved;
    });
    return respond(result);
  } catch (error) {
    return failed(error);
  }
}
