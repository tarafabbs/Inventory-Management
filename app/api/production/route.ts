import { createHash, randomUUID } from 'node:crypto';
import { db } from '@/lib/database';
import { inventorySession } from '@/lib/inventory-identity';
import { isManagement, isOfficeRole, isOwner, permitted, roleLabel } from '@/lib/rules';
import { actions, accountKey, planCommand, type Balance, type Command, type Document, type Delta } from '@/lib/production';
export const dynamic = 'force-dynamic';
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const reject = (s: string, status = 400) => Object.assign(new Error(s), { status });
async function user() { const s = await inventorySession(); if (!s.staff || !s.signedIn || !permitted(s.staff.role, 'read'))
    throw reject('Sign in with an approved Google account.', 403); return s.staff; }
const officeKinds = new Set(['office_receive', 'office_sell', 'office_return', 'office_vendor', 'vendor_return','correct']);
export async function GET(request: Request) {
    try {
        const u = await user();
        const q = new URL(request.url).searchParams;
        const page = Math.max(0, Math.min(10000, Number(q.get('page')) || 0));
        const company = q.get('company') || '';
        const office = isOfficeRole(u.role) || (isManagement(u.role) && q.get('view') === 'office');
        const scope = office ? " AND b.stage IN ('office_pending','office_stock','office_sold','office_return') AND (c.ownership='OWN' OR c.office_only=1)" : '';
        const results = await Promise.all([
            db.prepare(`SELECT b.* FROM inventory.production_balances b JOIN companies c ON c.id=b.company WHERE b.quantity>0 ${scope} ORDER BY b.company,b.product,b.stage`).all(),
            db.prepare(`SELECT id,kind,event_date,reference,notes,actor,actor_role,created_at,payload,delta FROM inventory.production_events WHERE (?='' OR company=? OR delta @> ?::text::jsonb) ${office ? "AND (kind IN ('office_send','office_receive','office_sell','office_return','office_vendor','vendor_return') OR kind='correct' AND payload->>'correctionKind'='office_vendor')" : ''} ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?`).bind(company, company, JSON.stringify([{company}]), page * 50).all(),
            db.prepare(`SELECT id,name,active,ownership,office_only,contact,address,notes FROM companies ${office ? "WHERE ownership='OWN' OR office_only=1" : ''} ORDER BY name`).all(),
            db.prepare(`SELECT id,name,active,office_only FROM products ${office ? "WHERE office_only=1 OR id IN (SELECT product FROM inventory.production_balances WHERE stage IN ('office_pending','office_stock','office_sold','office_return'))" : ''} ORDER BY name`).all(),
            office ? Promise.resolve({ results: [] }) : db.prepare('SELECT id,name,active,work_type,work_description,work_types,contact,address FROM artisans ORDER BY name').all(),
            office ? Promise.resolve({ results: [] }) : db.prepare('SELECT company,sum(amount)::float8 AS due FROM inventory.production_money GROUP BY company').all(),
            office ? Promise.resolve({ results: [] }) : db.prepare('SELECT * FROM inventory.production_documents WHERE voided_at IS NULL ORDER BY created_at DESC').all(),
            db.prepare("SELECT value FROM settings WHERE key='production_opening_date'").first(),
        ]);
        return reply({ user: { id: u.id, name: u.name, role: u.role }, balances: results[0].results, history: results[1].results.slice(0, 50), more: results[1].results.length > 50, companies: results[2].results, products: results[3].results, artisans: results[4].results, money: results[5].results, documents: results[6].results, openingDate: results[7]?.value || '' });
    }
    catch (e) {
        return failure(e);
    }
}
function failure(e: unknown) { console.error('Production ledger:', e instanceof Error ? e.message : 'unknown'); return reply({ error: e instanceof Error && !('code' in e) ? e.message : 'Could not reach the stock ledger. Retry with the same entry.' }, (e as {
    status?: number;
})?.status || ('code' in Object(e) ? 503 : 400)); }
export async function POST(request: Request) {
    try {
        if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin)
            throw reject('Use the inventory site.', 403);
        const u = await user();
        const body = await request.json();
        const { key, ...raw } = body;
        const c = raw as Command;
        if (!/^[a-f\d-]{36}$/i.test(key || ''))
            throw reject('Reload this form.');
        if (!actions[c.kind] && !['correct', 'delete', 'reset', 'undo_reset'].includes(c.kind))
            throw reject('Choose action.');
        if (isOfficeRole(u.role) && !officeKinds.has(c.kind))
            throw reject('Office access only.', 403);
        if (['delete', 'reset', 'undo_reset'].includes(c.kind) ? !isOwner(u.role) : c.kind === 'correct' ? !permitted(u.role, isOfficeRole(u.role)?'officeEdit':'handoff') : !permitted(u.role, actions[c.kind].permission))
            throw reject('Your access does not permit this action.', 403);
        if (c.lines !== undefined && !Array.isArray(c.lines))
            throw reject('Product lines must be a list.');
        if ((c.notes || '').length > 4000 || (c.reference || '').length > 200)
            throw reject('Keep remarks within 4,000 characters and bill number within 200.');
        const hash = createHash('sha256').update(JSON.stringify(c)).digest('hex');
        const result = await db.transaction(async (tx) => {
            await tx.prepare("SELECT pg_advisory_xact_lock(hashtextextended('production-posting',0))").run();
            if (!await tx.prepare('SELECT id FROM users WHERE id=? AND active=1 AND role=? FOR SHARE').bind(u.id, u.role).first())
                throw reject('Your access changed.', 403);
            const previous = await tx.prepare('SELECT fingerprint,result,actor_id FROM inventory.production_requests WHERE id=?').bind(key).first<{
                fingerprint: string;
                result: unknown;
                actor_id: string;
            }>();
            if (previous) {
                if (previous.actor_id !== u.id || previous.fingerprint !== hash)
                    throw reject('This request belongs to a different entry.', 409);
                return previous.result;
            }
            const [stockRows, documentRows, masters] = await Promise.all([
                tx.prepare('SELECT * FROM inventory.production_balances').all<Balance>(),
                tx.prepare('SELECT * FROM inventory.production_documents WHERE voided_at IS NULL').all<Document>(),
                tx.prepare(`SELECT
                  (SELECT coalesce(jsonb_object_agg(id,jsonb_build_object('ownership',ownership,'office_only',office_only,'active',active)),'{}') FROM companies) AS companies,
                  (SELECT coalesce(jsonb_object_agg(id,jsonb_build_object('office_only',office_only,'active',active)),'{}') FROM products) AS products,
                  (SELECT coalesce(jsonb_object_agg(id,jsonb_build_object('active',active,'work_type',work_type,'work_types',work_types)),'{}') FROM artisans) AS artisans
                `).first<{companies:Record<string,{ownership:string;office_only:number;active:number}>;products:Record<string,{office_only:number;active:number}>;artisans:Record<string,{active:number;work_type:string;work_types:string[]}>}>()
            ]);
            if (!masters) throw reject('Stock profiles unavailable.');
            const balances=stockRows.results, documents=documentRows.results;
            let p;
            let eventPayload: Command & {
                correctionKind?: string;
                resetDocuments?: string[];
            } = c;
            if (c.kind === 'reset') {
                if (!c.confirm || !c.notes?.trim())
                    throw reject('Review and confirm the quantity reset with a reason.');
                p = { deltas: balances.filter(b => b.quantity).map(b => ({ ...b, quantity: -b.quantity })), money: [] };
                eventPayload = { ...c, resetDocuments: documents.map(d => d.id) } as typeof eventPayload;
            }
            else if (c.kind === 'undo_reset') {
                const old = await tx.prepare("SELECT id,created_at,payload,delta FROM inventory.production_events WHERE id=?::uuid AND kind='reset'").bind(c.document || '').first<{
                    id: string;
                    created_at: Date;
                    payload: Command & {
                        resetDocuments: string[];
                    };
                    delta: Delta[];
                }>();
                if (!old || Date.now() - new Date(old.payload.originalCreatedAt||old.created_at).getTime() > 5 * 3600e3)
                    throw reject('Reset restore is available for five hours.');
                if (await tx.prepare("SELECT id FROM inventory.production_events WHERE created_at>(SELECT created_at FROM inventory.production_events WHERE id=?::uuid) AND kind<>'migration' LIMIT 1").bind(old.id).first())
                    throw reject('New stock entries exist after this reset. Ask for a supervised restore.');
                p = { deltas: old.delta.map(d => ({ ...d, quantity: -d.quantity })), money: [] };
                for (const id of old.payload.resetDocuments || [])
                    await tx.prepare('UPDATE inventory.production_documents SET voided_at=NULL WHERE id=?::uuid').bind(id).run();
            }
            else if (['correct', 'delete'].includes(c.kind)) {
                const old = await tx.prepare('SELECT * FROM inventory.production_events WHERE id=?::uuid FOR UPDATE').bind(c.document || '').first<{
                    kind: string;
                    actor_id: string;
                    created_at: Date;
                    delta: Delta[];
                    payload: Command;
                    id: string;
                    company: string;
                }>();
                if (documents.some(d => d.id === old?.id) || old?.payload.factoryDamage)
                    throw reject('Damage records require settlement; they cannot be reversed as a simple stock entry.');
                if (!old || !c.notes?.trim())
                    throw reject('Choose entry and give correction reason.');
                if (await tx.prepare("SELECT id FROM inventory.production_events WHERE payload->>'document'=? AND kind IN ('correct','delete')").bind(old.id).first())
                    throw reject('This entry is already corrected.');
                old.kind=old.payload.correctionKind||old.kind;
                if (!['office_vendor','issue', 'additional', 'reprint', 'return_send', 'receipt', 'receive', 'return_receive', 'dispute', 'company_return', 'payment', 'dispatch', 'opening', 'stock_count'].includes(old.kind))
                    throw reject('Linked settlement records require a supervised adjustment.');
                if (c.kind === 'correct') {
                    if(old.kind==='office_vendor'&&!isManagement(u.role)){if(!permitted(u.role,'officeEdit')||Date.now()-new Date(old.payload.originalCreatedAt||old.created_at).getTime()>864e5||JSON.stringify(c.lines||old.payload.lines)!==JSON.stringify(old.payload.lines))throw reject('Office receipt detail edits are limited to 24 hours; quantities stay unchanged.',403);}
                    if (!['office_vendor','issue', 'additional', 'reprint', 'return_send'].includes(old.kind) && !isManagement(u.role))
                        throw reject('Ask Management to correct this entry.', 403);
                    if (['issue', 'additional', 'reprint', 'return_send'].includes(old.kind) && (Date.now() - new Date(old.payload.originalCreatedAt||old.created_at).getTime() > 7 * 864e5 || (!isManagement(u.role) && u.role !== 'Supervisor' && (old.payload.originalActorId||old.actor_id) !== u.id)))
                        throw reject('Handoff correction is limited to seven days and permitted staff.', 403);
                }
                c.company = old.company;
                const reversed = (old.payload.effectiveDelta||old.delta).map(d => ({ ...d, quantity: -d.quantity }));
                const map = new Map(balances.map(b => [accountKey(b), { ...b }]));
                for (const d of reversed) {
                    const k = accountKey(d);
                    const b = map.get(k) || { ...d, quantity: 0 };
                    b.quantity += d.quantity;
                    if (b.quantity < 0 && c.kind === 'delete')
                        throw reject('Later movements depend on this entry. Cannot reverse it.', 409);
                    map.set(k, b);
                }
                const oldMoney = (await tx.prepare('SELECT company,amount::float8 AS amount FROM inventory.production_money WHERE event_id=?::uuid').bind(old.id).all<{
                    company: string;
                    amount: number;
                }>()).results;
                const money = (old.payload.effectiveMoney||oldMoney).map(m => ({ ...m, amount: -m.amount, kind: 'correction' }));
                if (c.kind === 'correct') {
                    const effective = { ...old.payload, kind:old.kind, date: c.date,reference:c.reference??old.payload.reference, notes: c.notes, lines: c.lines || old.payload.lines, amount: c.amount ?? old.payload.amount };
                    p = planCommand(effective, [...map.values()], documents);
                    eventPayload = { ...effective, kind: 'correct', document: old.id, correctionKind: old.kind,effectiveDelta:p.deltas,effectiveMoney:p.money,originalCreatedAt:old.payload.originalCreatedAt||old.created_at.toISOString(),originalActorId:old.payload.originalActorId||old.actor_id };
                    p.deltas = [...reversed, ...p.deltas];
                    p.money = [...money, ...p.money];
                }
                else
                    p = { deltas: reversed, money };
            }
            else
                p = planCommand(c, balances, documents);
            const checked = new Map(balances.map(b => [accountKey(b), b.quantity]));
            for (const d of p.deltas) {
                const k = accountKey(d);
                checked.set(k, (checked.get(k) || 0) + d.quantity);
            }
            if ([...checked.values()].some(n => n < 0))
                throw reject('Later movements depend on this entry. Correction would make stock negative.', 409);
            for (const l of c.lines || []) {
                if (l.artwork && l.artwork !== 'Legacy work — review') {
                    const valid = Object.values(masters.artisans).some(a=>a.active&&(a.work_types.includes(l.artwork!)||a.work_type===l.artwork));
                    if (!valid)
                        throw reject('Choose a listed artwork.');
                }
            }
            if (p.deltas.some(d => d.artisan && !d.work))
                throw reject('Artist-held stock needs an artwork.');
            const opening = await tx.prepare("SELECT value FROM settings WHERE key='production_opening_date'").first<{
                value: string;
            }>();
            if (c.kind === 'opening') {
                if (opening && opening.value !== c.date)
                    throw reject('Use the same opening date for all opening balances.');
                if (await tx.prepare("SELECT id FROM inventory.production_events WHERE kind NOT IN ('opening','migration','correct','delete') AND event_date < ?::date LIMIT 1").bind(c.date).first())
                    throw reject('Opening date must precede existing entries.');
                await tx.prepare("INSERT INTO settings(key,value) VALUES('production_opening_date',?) ON CONFLICT(key) DO NOTHING").bind(c.date).run();
            }
            else if (opening && c.date < opening.value)
                throw reject('Entry date precedes opening balance.');
            for (const d of p.deltas) {
                const company=masters.companies[d.company], product=masters.products[d.product];
                if (!company || !product)
                    throw reject('Company or category no longer exists.');
                if (company.office_only !== product.office_only) throw reject('Choose a category belonging to the same workshop / Office inventory.');
                if (d.stage.startsWith('office_') && company.ownership !== 'OWN' && !company.office_only) throw reject('Only Own Product or an Office vendor belongs in Office stock.');
                if (d.quantity > 0 && (!company.active || !product.active))
                    throw reject('Reactivate company/category before adding stock.');
                if (d.artisan) {
                    const artist=masters.artisans[d.artisan];
                    if (!artist || d.quantity > 0 && !artist.active)
                        throw reject('Choose an active artist.');
                }
                if (['office_send', 'office_receive', 'office_return', 'office_factory_receive'].includes(c.kind) && company.ownership !== 'OWN')
                    throw reject('Only Own Product uses workshop / Office transfers.');
                if (['office_vendor', 'vendor_return'].includes(c.kind) && (!company.office_only || !product.office_only || company.ownership === 'OWN'))
                    throw reject('Choose outside vendor and Office category.');
                if (isOfficeRole(u.role) && (!d.stage.startsWith('office_') || (company.ownership !== 'OWN' && !company.office_only)))
                    throw reject('This stock is outside Office access.', 403);
                if (c.kind === 'replacement' && d.quantity < 0 && (company.ownership !== 'OWN' || company.office_only))
                    throw reject('Replacement source must be TaraFabbs Own workshop stock.');
            }
            if (c.kind === 'opening' && p.deltas.some(d => d.pool === 'company_return' && ['raw', 'delivered', 'reprint'].includes(d.stage)))
                throw reject('Company Return opening belongs in Hold, Artist or Ready.');
            if (c.kind === 'opening') {
                for (const d of p.deltas) {
                    if (balances.some(b => accountKey(b) === accountKey(d) && b.quantity !== 0))
                        throw reject('Stock already exists. Use correction instead of another opening.');
                    if (await tx.prepare("SELECT id FROM inventory.production_events WHERE kind NOT IN ('opening','migration') AND delta @> ?::text::jsonb LIMIT 1").bind(JSON.stringify([{ company: d.company, product: d.product }])).first())
                        throw reject('Enter opening before regular movements for this category.');
                }
            }
            for (const m of p.money) {
                if (!await tx.prepare('SELECT id FROM companies WHERE id=?').bind(m.company).first())
                    throw reject('Choose company.');
                if (c.kind === 'opening' && await tx.prepare('SELECT id FROM inventory.production_money WHERE company=? LIMIT 1').bind(m.company).first())
                    throw reject('Financial opening already exists.');
                if (m.kind === 'damage_adjustment') {
                    const due = await tx.prepare('SELECT coalesce(sum(amount),0)::float8 AS due FROM inventory.production_money WHERE company=?').bind(m.company).first<{
                        due: number;
                    }>();
                    if (-m.amount > Number(due?.due || 0))
                        throw reject('Adjustment exceeds current due. Settle remaining damage separately.');
                }
            }
            const id = randomUUID();
            await tx.prepare('INSERT INTO inventory.production_events(id,kind,company,event_date,reference,notes,actor_id,actor,actor_role,payload,delta) VALUES(?::uuid,?,?,?::date,?,?,?,?,?,?::text::jsonb,?::text::jsonb)').bind(id, c.kind, c.company || c.targetCompany || p.deltas[0]?.company || '', c.date, c.reference || '', c.notes || '', u.id, u.name, roleLabel(u.role), JSON.stringify(eventPayload), JSON.stringify(p.deltas)).run();
            // Aggregate net deltas before UPSERT: corrections may reverse and repost the same account.
            const net = new Map<string, Delta>();
            for (const d of p.deltas) {
                const k = accountKey(d);
                net.set(k, { ...d, quantity: (net.get(k)?.quantity || 0) + d.quantity });
            }
            for (const [key, d] of net)
                if (d.quantity) {
                    const updated = await tx.prepare('UPDATE inventory.production_balances SET quantity=quantity+?,since=CASE WHEN quantity=0 THEN clock_timestamp() ELSE since END WHERE key=? RETURNING key').bind(d.quantity, key).first();
                    if (!updated)
                        await tx.prepare('INSERT INTO inventory.production_balances(key,company,product,pool,stage,artisan,arts,work,quantity) VALUES(?,?,?,?,?,?,?,?,?)').bind(key, d.company, d.product, d.pool, d.stage, d.artisan, d.arts, d.work, d.quantity).run();
                }
            for (const m of p.money)
                await tx.prepare('INSERT INTO inventory.production_money(event_id,company,amount,kind) VALUES(?::uuid,?,?,?)').bind(id, m.company, m.amount, m.kind).run();
            if (p.damage || p.order) {
                const doc = p.damage || p.order!;
                await tx.prepare('INSERT INTO inventory.production_documents(id,kind,company,quantity,amount,payload) VALUES(?::uuid,?,?,?,?,?::text::jsonb)').bind(id, p.damage ? 'damage' : 'order', doc.company, doc.quantity, Math.round((c.amount || 0) * 100), JSON.stringify(c)).run();
            }
            if (c.kind === 'reset')
                await tx.prepare('UPDATE inventory.production_documents SET voided_at=clock_timestamp() WHERE voided_at IS NULL').run();
            if(p.damageSettle)await tx.prepare('UPDATE inventory.production_documents SET settled=settled+? WHERE id=?::uuid').bind(p.damageSettle.quantity,p.damageSettle.id).run();
            if (p.settle)
                await tx.prepare('UPDATE inventory.production_documents SET settled=settled+?,settled_amount=settled_amount+? WHERE id=?::uuid').bind(p.settle.quantity, p.settle.amount, p.settle.id).run();
            const saved = { ok: true, id, message: 'Saved. Stock and company accounts updated.' };
            await tx.prepare('INSERT INTO inventory.production_requests(id,actor_id,fingerprint,result) VALUES(?,?,?,?::text::jsonb)').bind(key, u.id, hash, JSON.stringify(saved)).run();
            return saved;
        });
        return reply(result);
    }
    catch (e) {
        return failure(e);
    }
}
