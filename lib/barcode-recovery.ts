import type { LedgerDatabase } from './database';

const officeHolders = ['OFFICE_PENDING', 'OFFICE_STOCK', 'SOLD', 'FACTORY_RETURN_PENDING'];
const isOfficeRole = (role:string) => ['Office Staff','Assistant Manager','Office Manager'].includes(role);
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const required = (value: unknown, name: string, min = 3) => {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > 2000)
    throw fail(`${name} must contain ${min}–2000 characters.`);
  return value.trim();
};
const officeScope = "p.holder IN ('OFFICE_PENDING','OFFICE_STOCK','SOLD','FACTORY_RETURN_PENDING')";

export async function recoveryRead(db: LedgerDatabase, user: any, params: URLSearchParams) {
  const office = isOfficeRole(user.role);
  if (params.get('recovery') === 'search') {
    const q = (params.get('q') || '').trim().slice(0, 150);
    const company = params.get('company') || '', product = params.get('product') || '';
    if (q.length < 2 && !company && !product) return { candidates: [], hasMore: false };
    const matches = `(?='' OR p.company_id=?) AND (?='' OR p.product_id=?) AND
      (strpos(lower(concat_ws(' ',p.code,c.name,pr.name,pr.material,pr.color,pr.design,l.reference,l.number,l.received_at,a.name,p.holder)),lower(?))>0
      OR (length(regexp_replace(lower(?),'[^a-z0-9]','','g'))>=2
        AND strpos(regexp_replace(lower(p.code),'[^a-z0-9]','','g'),regexp_replace(lower(?),'[^a-z0-9]','','g'))>0))`;
    const columns = `p.id,p.code,p.company_id,p.product_id,p.lot_id,p.ownership,p.holder,p.condition,p.version,
      c.name AS company_name,pr.name AS product_name,pr.color,pr.design,pr.material,
      l.number AS lot_number,l.reference AS bill_number,l.received_at,a.name AS artisan_name`;
    const args = [company, company, product, product, q, q, q];
    const pending = office ? '' : `UNION ALL SELECT g.id,g.code,g.company_id,g.product_id,g.lot_id,g.ownership,
      'NOT_REGISTERED','PENDING_LABEL_CONFIRMATION',0,c.name,pr.name,pr.color,pr.design,pr.material,
      l.number,l.reference,l.received_at,NULL,'pending' FROM generated_labels g
      JOIN companies c ON c.id=g.company_id JOIN products pr ON pr.id=g.product_id JOIN lots l ON l.id=g.lot_id
      WHERE g.state='PENDING' AND NOT EXISTS(SELECT 1 FROM pieces p WHERE p.code=g.code)
      AND (?='' OR g.company_id=?) AND (?='' OR g.product_id=?)
      AND (strpos(lower(concat_ws(' ',g.code,c.name,pr.name,pr.material,pr.color,pr.design,l.reference,l.number,l.received_at)),lower(?))>0
      OR (length(regexp_replace(lower(?),'[^a-z0-9]','','g'))>=2
        AND strpos(regexp_replace(lower(g.code),'[^a-z0-9]','','g'),regexp_replace(lower(?),'[^a-z0-9]','','g'))>0))`;
    const { results } = await db.prepare(`SELECT * FROM (SELECT ${columns},'piece' AS kind FROM pieces p
      JOIN companies c ON c.id=p.company_id JOIN products pr ON pr.id=p.product_id JOIN lots l ON l.id=p.lot_id
      LEFT JOIN artisans a ON a.id=p.artisan_id WHERE ${office ? officeScope : 'true'} AND ${matches}
      ${pending}) candidates ORDER BY code LIMIT 51`).bind(...args, ...(office ? [] : args)).all();
    return { candidates: results.slice(0, 50), hasMore: results.length > 50 };
  }
  const id = params.get('id') || '';
  const status = params.get('status') || 'OPEN';
  const offset = Math.floor(Math.min(100000, Math.max(0, Number(params.get('offset')) || 0)));
  const scope = office ? `(r.scope='OFFICE' OR EXISTS(SELECT 1 FROM pieces p WHERE p.code=r.code AND ${officeScope}))` : 'true';
  const state = id ? 'r.id=?' : status === 'ALL' ? 'true' : status === 'CLOSED' ? "r.status IN ('CONFIRMED','CANCELLED')" : "r.status IN ('UNIDENTIFIED','AWAITING_SCAN')";
  const { results } = await db.prepare(`SELECT r.* FROM barcode_recoveries r WHERE ${scope} AND ${state}
    ORDER BY r.created_at DESC,r.id DESC LIMIT 21 OFFSET ?`).bind(...(id ? [id] : []), id ? 0 : offset).all();
  return { recoveries: results.slice(0, 20), hasMore: results.length > 20 };
}

export async function recoveryOperation(ctx: any) {
  const { op, v, db, add, guard, event, transaction, actor, user, time, uuid } = ctx;
  if (!['recoveryReport', 'recoveryCreate', 'recoveryStart', 'recoveryPrint', 'recoveryConfirm', 'recoveryCancel'].includes(op)) return null;
  const office = isOfficeRole(user.role);
  let record: any = null;
  if (v.id) {
    record = await db.prepare('SELECT * FROM barcode_recoveries WHERE id=?').bind(v.id).first();
    if (!record) throw fail('Recovery record not found.', 404);
    if (office && !record.code && record.scope !== 'OFFICE') throw fail('This record is outside Office access.', 403);
    if (['CONFIRMED', 'CANCELLED'].includes(record.status)) throw fail('This recovery is already closed. Start a new recovery if needed.', 409);
    add('SELECT id FROM barcode_recoveries WHERE id=? FOR UPDATE', record.id);
    guard('SELECT COUNT(*)=1 FROM barcode_recoveries WHERE id=? AND status=?', record.id, record.status);
  }
  if (op === 'recoveryReport') {
    if (record) throw fail('Create a separate report for each unidentified physical piece.');
    const id = uuid();
    add(`INSERT INTO barcode_recoveries(id,status,reason,evidence,scope,actor,created_at)
      VALUES(?,'UNIDENTIFIED',?,?,?,?,?)`, id, required(v.reason, 'Problem / physical location', 10), '', office ? 'OFFICE' : 'FACTORY', actor, time);
    return { ok: true, recoveryId: id };
  }
  if (op === 'recoveryCreate') {
    if (record) throw fail('Create each barcode-free recovery as a separate record.');
    if (user.role === 'Office Staff') throw fail('Office Staff can restore an existing label. Assistant Manager or Office Manager must create a new outside-vendor identity.', 403);
    if (v.confirmed !== true) throw fail('Confirm that no original barcode or exact saved identity can be recovered.');
    const company = await db.prepare('SELECT * FROM companies WHERE id=? AND active=1 AND office_only=?').bind(v.company_id || '', office ? 1 : 0).first();
    const product = await db.prepare('SELECT * FROM products WHERE id=? AND active=1 AND office_only=?').bind(v.product_id || '', office ? 1 : 0).first();
    if (!company) throw fail(office ? 'Choose an active Office vendor.' : 'Choose an active company or own brand.');
    if (!product) throw fail(office ? 'Choose an active Office product.' : 'Choose an active workshop product.');
    if (office && company.ownership !== 'EXTERNAL') throw fail('Office barcode-free recovery requires an outside Office vendor.');
    const businessDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
    const receivedAt = String(v.received_at || '').trim() || businessDate;
    const reference = String(v.reference || '').trim();
    const parsedReceivedAt = new Date(`${receivedAt}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedAt) || Number.isNaN(parsedReceivedAt.getTime()) || parsedReceivedAt.toISOString().slice(0, 10) !== receivedAt) throw fail('Enter a valid received date or leave it blank.');
    if (reference.length > 200) throw fail('Keep the optional bill / challan number under 200 characters.');
    let thanwala: any = null;
    if (!office && company.ownership === 'OWN') {
      thanwala = await db.prepare('SELECT * FROM thanwalas WHERE id=? AND active=1').bind(v.thanwala_id || '').first();
      if (!thanwala) throw fail('Choose the purchase Thanwala for TaraFabbs Own Product.');
    } else if (v.thanwala_id) throw fail('Thanwala applies only to TaraFabbs Own Product.');
    guard('SELECT COUNT(*)=1 FROM companies WHERE id=? AND active=1 AND office_only=? AND sequence=?', company.id, office ? 1 : 0, company.sequence);
    guard('SELECT COUNT(*)=1 FROM products WHERE id=? AND active=1 AND office_only=?', product.id, office ? 1 : 0);
    if (thanwala) guard('SELECT COUNT(*)=1 FROM thanwalas WHERE id=? AND active=1', thanwala.id);
    const lotId = uuid(), labelId = uuid(), recoveryId = uuid();
    const journey = office ? 'OFFICE' : 'WORKSHOP';
    const code = `${company.prefix}-${String(Number(company.sequence) + 1).padStart(6, '0')}`;
    const lotNumber = `${office ? 'OFF' : 'LOT'}-${time.slice(2, 10).replaceAll('-', '')}-${lotId.slice(0, 6).toUpperCase()}`;
    const reason = 'Original barcode completely unavailable; controlled new permanent identity created';
    const referenceLabel = reference ? `Bill / challan ${reference}` : 'Bill / challan not recorded';
    const evidence = `Physical item verified without a recoverable barcode; ${company.name}; ${product.name}; ${referenceLabel}; received ${receivedAt}.`;
    const item = { id: labelId, code, company_id: company.id, product_id: product.id, lot_id: lotId, ownership: company.ownership, thanwala_id: thanwala?.id || null, journey: office ? 'OFFICE' : 'WORKSHOP', holder: office ? 'OFFICE_PENDING' : 'NOT_REGISTERED', condition: 'PENDING_LABEL_CONFIRMATION', version: office ? 1 : 0, created_at: time, company_name: company.name, product_name: product.name, lot_number: lotNumber, bill_number: reference, received_at: receivedAt, recovery_new_identity: true };
    add("INSERT INTO lots(id,number,company_id,product_id,ownership,thanwala_id,journey,received_at,reference,stated,accepted,damaged,rejected,reason,notes,status,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?,1,1,0,0,?,?,'PREPARED',?,?)", lotId, lotNumber, company.id, product.id, company.ownership, thanwala?.id || null, journey, receivedAt, reference, reason, 'Barcode-free recovery · new identity pending attached-label scan', actor, time);
    add('UPDATE companies SET sequence=sequence+1 WHERE id=?', company.id);
    if (office) {
      add("INSERT INTO pieces(id,code,company_id,product_id,lot_id,ownership,journey,holder,condition,version,created_at) VALUES(?,?,?,?,?,?,'OFFICE','OFFICE_PENDING','PENDING_LABEL_CONFIRMATION',1,?)", labelId, code, company.id, product.id, lotId, company.ownership, time);
      const tx = transaction('OFFICE_VENDOR_INTAKE', null, `Barcode absent recovery · ${company.name} · ${referenceLabel}`, [item]);
      event(item, 'OFFICE_VENDOR_REGISTERED', null, item, `${reason}; ${referenceLabel}`, tx);
    } else add("INSERT INTO generated_labels(id,code,company_id,product_id,lot_id,ownership,thanwala_id,state,created_at) VALUES(?,?,?,?,?,?,?,'PENDING',?)", labelId, code, company.id, product.id, lotId, company.ownership, thanwala?.id || null, time);
    add("INSERT INTO barcode_recoveries(id,code,status,reason,evidence,identified_reason,scope,actor,created_at,identified_by,identified_at,snapshot) VALUES(?,?,'AWAITING_SCAN',?,?,?,?,?,?,?,?,?)", recoveryId, code, reason, evidence, reason, office ? 'OFFICE' : 'FACTORY', actor, time, actor, time, JSON.stringify(item));
    add('INSERT INTO print_jobs(id,codes,reason,actor,created_at,status,verified) VALUES(?,?,?,?,?,?,1)', uuid(), JSON.stringify([code]), `Barcode-free recovery ${recoveryId}: ${reason}`, actor, time, 'REQUESTED');
    return { ok: true, recoveryId, lotId, codes: [code] };
  }
  if (op !== 'recoveryStart' && !record) throw fail('Select an existing recovery record.');
  if (op === 'recoveryStart' && record && record.status !== 'UNIDENTIFIED') throw fail('Resume the existing replacement instead of starting another.', 409);
  const code = String(record?.code || v.code || '').trim().toUpperCase();
  const p = code ? await db.prepare('SELECT * FROM pieces WHERE code=?').bind(code).first() : null;
  const g = !p && code ? await db.prepare("SELECT * FROM generated_labels WHERE code=? AND state='PENDING'").bind(code).first() : null;
  if (office && code && (!p || !officeHolders.includes(p.holder))) throw fail('This barcode is outside Office access. Ask Factory Staff to continue its recovery.', 403);
  if (op === 'recoveryCancel') {
    try { if (JSON.parse(record.snapshot || '{}').recovery_new_identity) throw fail('A newly created permanent barcode cannot be cancelled here. If it was created in error, Admin must use Data Control within five hours.'); } catch (error: any) { if (error?.status) throw error; }
    const reason = required(v.reason, 'Cancellation reason');
    add("UPDATE barcode_recoveries SET status='CANCELLED',closed_reason=?,closed_at=?,confirmed_by=? WHERE id=?", reason, time, actor, record.id);
    if (p) event(p, 'LABEL_RECOVERY_CANCELLED', p, p, `${record.id}: ${reason}`);
    return { ok: true, recoveryId: record.id };
  }
  if (!p && !g) throw fail('This code is unknown or its prepared label was replaced by a bill edit. Find the current valid label; never reuse a voided code.', 409);
  const item = p || g;
  // Lock and validate identity without changing stock, custody, condition or version.
  if (p) {
    add('SELECT id FROM pieces WHERE id=? FOR UPDATE', p.id);
    guard('SELECT COUNT(*)=1 FROM pieces WHERE id=? AND version=?', p.id, p.version);
  } else {
    add('SELECT id FROM generated_labels WHERE id=? FOR UPDATE', g.id);
    guard("SELECT COUNT(*)=1 FROM generated_labels WHERE id=? AND state='PENDING'", g.id);
  }
  if (op === 'recoveryStart') {
    if (v.verified !== true) throw fail('Confirm that the physical saree is uniquely matched to this exact Piece Code.');
    const reason = required(v.reason, 'Replacement reason'), evidence = required(v.evidence, 'Physical identification evidence', 10);
    const active = await db.prepare("SELECT id FROM barcode_recoveries WHERE code=? AND status='AWAITING_SCAN'").bind(code).first();
    if (active) throw fail('A replacement is already awaiting attachment for this code. Open it from Pending recoveries.', 409);
    const id = record?.id || uuid();
    if (record) add(`UPDATE barcode_recoveries SET code=?,status='AWAITING_SCAN',evidence=?,identified_reason=?,identified_by=?,identified_at=?,snapshot=? WHERE id=?`, code, evidence, reason, actor, time, JSON.stringify(item), id);
    else add(`INSERT INTO barcode_recoveries(id,code,status,reason,evidence,identified_reason,scope,actor,created_at,identified_by,identified_at,snapshot)
      VALUES(?,?,'AWAITING_SCAN',?,?,?,?,?,?,?,?,?)`, id, code, reason, evidence, reason, office ? 'OFFICE' : 'FACTORY', actor, time, actor, time, JSON.stringify(item));
    if (p) event(p, 'LABEL_RECOVERY_REQUESTED', p, p, `${id}: ${reason}. Identity evidence: ${evidence}`);
    add('INSERT INTO print_jobs(id,codes,reason,actor,created_at,status,verified) VALUES(?,?,?,?,?,?,1)', uuid(), JSON.stringify([code]), `Barcode recovery ${id}: ${reason}`, actor, time, 'REQUESTED');
    return { ok: true, recoveryId: id, codes: [code] };
  }
  if (record.status !== 'AWAITING_SCAN') throw fail('Identify the physical piece before printing or confirming.');
  if (op === 'recoveryPrint') {
    add('INSERT INTO print_jobs(id,codes,reason,actor,created_at,status,verified) VALUES(?,?,?,?,?,?,1)', uuid(), JSON.stringify([code]), `Barcode recovery ${record.id}: printer retry`, actor, time, 'REQUESTED');
    if (p) event(p, 'LABEL_RECOVERY_PRINT_RETRY', p, p, `Printer retry for recovery ${record.id}`);
    return { ok: true, recoveryId: record.id, codes: [code] };
  }
  if (String(v.code || '').trim().toUpperCase() !== code) throw fail('The scanned code does not match this replacement label. Nothing has changed.');
  if (v.attached !== true || !['camera', 'scanner'].includes(v.source)) throw fail('Attach the replacement, remove any old / spare labels, and scan the attached barcode.');
  add("UPDATE barcode_recoveries SET status='CONFIRMED',confirmed_at=?,confirmed_by=?,confirmation_source=? WHERE id=?", time, actor, v.source, record.id);
  if (p) event(p, 'LABEL_RECOVERY_CONFIRMED', p, p, `Replacement attached and checked; recovery ${record.id}. ${record.evidence}`);
  return { ok: true, recoveryId: record.id };
}
