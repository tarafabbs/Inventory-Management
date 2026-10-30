// Integration checks run inside one rolled-back transaction. No fixture records persist.
// Run: node --env-file=.env scripts/test-barcode-recovery.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import postgres from 'postgres';

async function load(path) {
  const code = ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const { recoveryRead, recoveryOperation } = await load('../lib/barcode-recovery.ts');
const { permitted, canManageUser } = await load('../lib/rules.ts');
const url = process.env.SUPABASE_DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL;
assert.ok(url, 'Set the database URL before running integration checks.');
const sql = postgres(url, { max: 1, prepare: false, ssl: 'require', connect_timeout: 15 });
const tables = ['barcode_recoveries', 'pieces', 'generated_labels', 'companies', 'products', 'lots', 'artisans', 'guards', 'print_jobs', 'piece_events', 'thanwalas', 'transactions'];
function statement(query) {
  for (const table of tables) query = query.replace(new RegExp(`\\b(FROM|JOIN|INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`, 'gi'), (_, keyword) => `${keyword} inventory.${table}`);
  let index = 0;
  return query.replace(/\?/g, () => `$${++index}`);
}
function database(tx) {
  return { prepare(query) { return { bind(...args) { return {
    async first() { return (await tx.unsafe(statement(query), args))[0] || null; },
    async all() { return { results: await tx.unsafe(statement(query), args) }; },
  }; } }; } };
}
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const rollback = new Error('ROLLBACK_SUCCESSFUL_TEST');
try {
  await sql.begin(async tx => {
    const id = () => crypto.randomUUID(), time = new Date().toISOString();
    const company = id(), product = id(), lot = id(), thanwala = id();
    const officeCompany = id(), officeProduct = id();
    const prefix = 'Q' + id().replace(/[^a-f]/g, '').slice(0, 5).toUpperCase();
    const marker = 'recovery-test-' + id();
    await tx`insert into inventory.companies(id,name,prefix,ownership) values(${company},${marker},${prefix},'OWN')`;
    await tx`insert into inventory.products(id,name,color,design) values(${product},${marker},'indigo','unique test motif')`;
    await tx`insert into inventory.thanwalas(id,name,created_at) values(${thanwala},${marker + '-thanwala'},${time})`;
    await tx`insert into inventory.companies(id,name,prefix,ownership,office_only) values(${officeCompany},${marker + '-office-vendor'},${'O' + prefix},'EXTERNAL',1)`;
    await tx`insert into inventory.products(id,name,office_only) values(${officeProduct},${marker + '-office-product'},1)`;
    await tx`insert into inventory.lots(id,number,company_id,product_id,ownership,received_at,reference,stated,accepted,damaged,rejected,status,actor,created_at)
      values(${lot},${marker},${company},${product},'OWN',${time},${marker},3,3,0,0,'PREPARED','Recovery test',${time})`;
    const fixture = async (suffix, holder, condition = 'AVAILABLE') => {
      const pid = id(), code = `${prefix}-${suffix}`;
      await tx`insert into inventory.pieces(id,code,company_id,product_id,lot_id,ownership,holder,condition,label_confirmed_at,version,created_at)
        values(${pid},${code},${company},${product},${lot},'OWN',${holder},${condition},${time},1,${time})`;
      return { id: pid, code };
    };
    const factory = await fixture('900001', 'IN_HOUSE', 'FINISHED');
    const office = await fixture('900002', 'OFFICE_STOCK', 'FINISHED');
    const pending = { id: id(), code: `${prefix}-900003` };
    await tx`insert into inventory.generated_labels(id,code,company_id,product_id,lot_id,ownership,state,created_at)
      values(${pending.id},${pending.code},${company},${product},${lot},'OWN','PENDING',${time})`;
    const db = database(tx);
    const before = await tx`select * from inventory.pieces where company_id=${company} order by code`;
    async function run(op, v, role = 'Admin') {
      check(permitted(role, 'recovery'), `${role} must have recovery permission`);
      return tx.savepoint(async step => {
        const writes = [], add = (query, ...args) => writes.push(() => step.unsafe(statement(query), args));
        const guard = (query, ...args) => { const gid = id(); add(`INSERT INTO guards(id,ok) VALUES(?,CASE WHEN (${query}) THEN 1 ELSE 0 END)`, gid, ...args); add('DELETE FROM guards WHERE id=?', gid); };
        const event = (p, type, b, a, reason, transactionId = null) => add('INSERT INTO piece_events(id,piece_id,type,transaction_id,actor,created_at,reason,before_state,after_state) VALUES(?,?,?,?,?,?,?,?,?)', id(), p.id, type, transactionId, 'Recovery test', time, reason, JSON.stringify(b), JSON.stringify(a));
        const transaction = (type, artisan, reason, lines) => { const transactionId = id(); add('INSERT INTO transactions(id,number,type,artisan_id,status,reason,actor,created_at,snapshot) VALUES(?,?,?,?,?,?,?,?,?)', transactionId, `ON-${transactionId.slice(0, 8)}`, type, artisan, 'CONFIRMED', reason, 'Recovery test', time, JSON.stringify(lines)); return transactionId; };
        const result = await recoveryOperation({ op, v, db: database(step), add, guard, event, transaction, actor: 'Recovery test', user: { role }, time, uuid: id });
        for (const write of writes) await write();
        return result;
      });
    }
    const verified = code => ({ code, reason: 'Label accidentally torn', evidence: 'Readable code and independent sewn piece tag matched.', verified: true });
    const search = (role, q, extra = {}) => recoveryRead(db, { role }, new URLSearchParams({ recovery: 'search', q, ...extra }));
    check((await search('Admin', marker)).candidates.length === 3, 'Bill/company search includes stock and reserved labels');
    check((await search('Office Staff', marker)).candidates.length === 1, 'Office search excludes factory and pending labels');
    check((await search('Office Manager', marker)).candidates.length === 1, 'Office Manager recovery search is office-scoped');
    check((await search('Admin', '', { company })).candidates.length === 3, 'Company filter works without code');
    check((await search('Admin', factory.code.replaceAll('-', '').slice(-5))).candidates.some(item => item.code === factory.code), 'Visible code fragment matches even without separators');
    check((await search('Admin', '---')).candidates.length === 0, 'Punctuation-only input never matches every barcode');
    check((await search('Admin', 'no-match')).candidates.length === 0, 'Unknown text returns no candidates');
    check(!permitted('Viewer', 'recovery') && !permitted('Operator', 'recovery'), 'Read-only/unsupported staff cannot recover');
    check(permitted('Office Manager', 'officeEntry') && permitted('Office Manager', 'officeReceive') && permitted('Office Manager', 'user') && !permitted('Office Manager', 'receipt') && !permitted('Office Manager', 'handoff') && !permitted('Office Manager', 'settings'), 'Office Manager is restricted to office work and office access control');
    check(permitted('Assistant Manager', 'officeEntry') && permitted('Assistant Manager', 'officeSell') && !permitted('Assistant Manager', 'user') && !permitted('Assistant Manager', 'receipt'), 'Assistant Manager can operate office inventory but cannot manage access or workshop work');
    check(!permitted('Office Staff', 'officeEntry') && permitted('Office Staff', 'officeReceive'), 'Office Staff keeps scanning access without Office New Entry authority');
    check(canManageUser('Office Manager', null, 'Office Staff') && canManageUser('Office Manager', 'Assistant Manager', 'Office Staff') && !canManageUser('Office Manager', 'Admin', 'Office Staff') && !canManageUser('Office Manager', null, 'Supervisor'), 'Office Manager can grant only Office Staff and Assistant Manager access');
    await assert.rejects(run('recoveryStart', { ...verified(factory.code), verified: false }), /physically|physical/);
    await assert.rejects(run('recoveryStart', { ...verified(factory.code), evidence: 'same' }), /evidence/);
    await assert.rejects(run('recoveryStart', verified(factory.code), 'Office Staff'), /outside Office/);
    const started = await run('recoveryStart', verified(factory.code), 'Receiving');
    check(started.codes[0] === factory.code, 'Replacement keeps the exact code');
    await assert.rejects(run('recoveryStart', verified(factory.code)), /already awaiting/);
    await assert.rejects(tx.savepoint(step => step.unsafe(`insert into inventory.barcode_recoveries select $1,code,status,reason,evidence,identified_reason,scope,actor,created_at,identified_by,identified_at,snapshot,confirmed_by,confirmed_at,confirmation_source,closed_reason,closed_at from inventory.barcode_recoveries where id=$2`, [id(), started.recoveryId])), /unique|duplicate/);
    await run('recoveryPrint', { id: started.recoveryId });
    await assert.rejects(run('recoveryConfirm', { id: started.recoveryId, code: office.code, source: 'scanner', attached: true }), /does not match/);
    await assert.rejects(run('recoveryConfirm', { id: started.recoveryId, code: factory.code, source: 'camera', attached: false }), /Attach/);
    await run('recoveryConfirm', { id: started.recoveryId, code: factory.code, source: 'camera', attached: true });
    await assert.rejects(run('recoveryConfirm', { id: started.recoveryId, code: factory.code, source: 'camera', attached: true }), /already closed/);
    check((await tx`select count(*)::int as n from inventory.piece_events where piece_id=${factory.id}`)[0].n === 3, 'Start, print retry and attachment are audited');
    check((await tx`select count(*)::int as n from inventory.print_jobs where codes=${JSON.stringify([factory.code])}`)[0].n === 2, 'Print attempts are recorded independently');
    await assert.rejects(tx.savepoint(step => step`update inventory.barcode_recoveries set reason='Rewrite' where id=${started.recoveryId}`), /cannot be rewritten/);
    await assert.rejects(tx.savepoint(step => step`delete from inventory.barcode_recoveries where id=${started.recoveryId}`), /permanent/);
    const reserve = await run('recoveryStart', verified(pending.code));
    await run('recoveryConfirm', { id: reserve.recoveryId, code: pending.code, source: 'scanner', attached: true });
    check(!(await tx`select id from inventory.pieces where code=${pending.code}`).length, 'Pending label recovery never creates inventory');
    check((await tx`select state from inventory.generated_labels where id=${pending.id}`)[0].state === 'PENDING', 'Pending intake is preserved');
    const report = await run('recoveryReport', { reason: 'Unknown indigo saree kept on shelf C pending artist verification.' }, 'Office Staff');
    const identified = await run('recoveryStart', { ...verified(office.code), id: report.recoveryId }, 'Office Staff');
    check(identified.recoveryId === report.recoveryId, 'Identified item continues its original report');
    await run('recoveryConfirm', { id: report.recoveryId, code: office.code, source: 'scanner', attached: true }, 'Office Staff');
    const cancellation = await run('recoveryStart', verified(factory.code));
    await run('recoveryCancel', { id: cancellation.recoveryId, reason: 'Found the original intact label; discarded replacement.' });
    await assert.rejects(run('recoveryPrint', { id: cancellation.recoveryId }), /already closed/);
    await assert.rejects(run('recoveryCreate', { company_id: company, product_id: product, thanwala_id: thanwala, confirmed: false }), /Confirm/);
    await assert.rejects(run('recoveryCreate', { company_id: company, product_id: product, confirmed: true }), /Thanwala/);
    const created = await run('recoveryCreate', { company_id: company, product_id: product, thanwala_id: thanwala, received_at: '', reference: '', confirmed: true }, 'Receiving');
    check(created.codes.length === 1 && created.codes[0].startsWith(prefix + '-'), 'No-barcode recovery reserves one new permanent code');
    const createdLabel = (await tx`select * from inventory.generated_labels where code=${created.codes[0]}`)[0];
    const createdLot = (await tx`select * from inventory.lots where id=${created.lotId}`)[0];
    const createdRecovery = (await tx`select * from inventory.barcode_recoveries where id=${created.recoveryId}`)[0];
    check(createdLabel?.state === 'PENDING' && createdLabel.thanwala_id === thanwala, 'Own-product recovery keeps the new label pending and tracks Thanwala');
    const businessDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
    check(createdLot.reference === '' && String(createdLot.received_at).slice(0, 10) === businessDate, 'Bill is optional and blank date defaults to today');
    check(createdRecovery.status === 'AWAITING_SCAN' && JSON.parse(createdRecovery.snapshot).recovery_new_identity === true, 'New identity is clearly audited in the recovery register');
    check(!(await tx`select id from inventory.pieces where code=${created.codes[0]}`).length, 'New recovery code does not enter inventory before normal Scan In');
    await assert.rejects(run('recoveryCancel', { id: created.recoveryId, reason: 'Mistake' }, 'Receiving'), /cannot be cancelled/);
    await run('recoveryConfirm', { id: created.recoveryId, code: created.codes[0], source: 'scanner', attached: true }, 'Receiving');
    check((await tx`select state from inventory.generated_labels where code=${created.codes[0]}`)[0].state === 'PENDING', 'Attached-label confirmation still leaves factory inventory entry to Scan In');
    await assert.rejects(run('recoveryCreate', { company_id: officeCompany, product_id: officeProduct, confirmed: true }, 'Office Staff'), /Office Staff/);
    await assert.rejects(run('recoveryCreate', { company_id: company, product_id: product, confirmed: true }, 'Assistant Manager'), /Office vendor/);
    const officeCreated = await run('recoveryCreate', { company_id: officeCompany, product_id: officeProduct, received_at: '', reference: '', confirmed: true }, 'Assistant Manager');
    const officeCreatedPiece = (await tx`select * from inventory.pieces where code=${officeCreated.codes[0]}`)[0];
    check(officeCreatedPiece.journey === 'OFFICE' && officeCreatedPiece.holder === 'OFFICE_PENDING' && officeCreatedPiece.condition === 'PENDING_LABEL_CONFIRMATION', 'Office no-barcode recovery stays in Office pending-label processing');
    check((await tx`select count(*)::int as n from inventory.transactions where type='OFFICE_VENDOR_INTAKE' and snapshot::text like ${'%' + officeCreated.codes[0] + '%'}`)[0].n === 1, 'Office no-barcode creation appears in Office journey history');
    await run('recoveryConfirm', { id: officeCreated.recoveryId, code: officeCreated.codes[0], source: 'camera', attached: true }, 'Assistant Manager');
    check((await tx`select holder from inventory.pieces where code=${officeCreated.codes[0]}`)[0].holder === 'OFFICE_PENDING', 'Office recovery confirmation does not bypass the normal Office receive scan');
    await tx`update inventory.generated_labels set state='VOIDED' where id=${pending.id}`;
    await assert.rejects(run('recoveryStart', verified(pending.code)), /voided|replaced/);
    check(!(await search('Admin', pending.code)).candidates.length, 'Voided labels never appear in recovery search');
    const officeRecords = await recoveryRead(db, { role: 'Office Staff' }, new URLSearchParams({ recovery: 'records', status: 'ALL' }));
    check(!officeRecords.recoveries.some(r => r.code === factory.code), 'Office recovery history respects scope');
    assert.deepEqual(await tx`select * from inventory.pieces where company_id=${company} order by code`, before);
    check(true, 'All recovery operations preserve every inventory field and version');
    console.log(`PASS: ${checks} assertions plus rejection checks. All fixtures will roll back.`);
    throw rollback;
  });
} catch (error) { if (error !== rollback) throw error; }
finally { await sql.end(); }
