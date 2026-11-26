import { createHash, randomUUID } from 'node:crypto';
import { db } from '@/lib/database';
import { inventorySession } from '@/lib/inventory-identity';
import { artisanWorkTypes, isManagement, isOfficeRole, permitted, roleLabel } from '@/lib/rules';
import { artisanIdentity } from '@/lib/artisan-identity';
export async function POST(request: Request) {
    try {
        if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin)
            throw Error('Use the inventory site.');
        const { staff: u, signedIn } = await inventorySession();
        if (!signedIn || !u)
            return Response.json({ error: 'Sign in.' }, { status: 401 });
        const v = await request.json();
        const entity = { company: 'companies', product: 'products', artisan: 'artisans', art_style:'inventory.art_styles' }[String(v.kind)];
        if (!entity)
            throw Error('Choose profile type.');
        if(entity==='inventory.art_styles'&&(isOfficeRole(u.role)||v.id))return Response.json({error:'Create art styles from Workshop access.'},{status:403});
        if (!permitted(u.role, v.id ? 'master' : 'masterCreate') && !(isOfficeRole(u.role) && permitted(u.role, 'officeMaster')))
            return Response.json({ error: 'Access denied.' }, { status: 403 });
        if(v.view==='office'&&!isManagement(u.role)&&!isOfficeRole(u.role))return Response.json({error:'Office profile access required.'},{status:403});
        const officeCreation=isOfficeRole(u.role)||v.view==='office';
        const name = String(v.name || '').trim(), contact = String(v.contact || '').trim(), address = String(v.address || '').trim(), notes = String(v.notes || '').trim();
        if (!name || name.length > 120 || contact.length > 200 || address.length > 1000 || notes.length > 2000)
            throw Error('Check the profile details and field lengths.');
        if (!/^[a-f\d-]{36}$/i.test(v.key || ''))
            throw Error('Reload this form.');
        const hash = createHash('sha256').update(JSON.stringify(v)).digest('hex');
        const result = await db.transaction(async (tx) => {
            await tx.prepare("SELECT pg_advisory_xact_lock(hashtextextended('production-posting',0))").run();
            if (!await tx.prepare('SELECT id FROM users WHERE id=? AND active=1 AND role=? FOR SHARE').bind(u.id, u.role).first())
                throw Error('Access changed.');
            const oldRequest = await tx.prepare('SELECT result,fingerprint,actor_id FROM inventory.production_requests WHERE id=?').bind(v.key).first<{
                result: unknown;
                fingerprint: string;
                actor_id: string;
            }>();
            if (oldRequest) {
                if (oldRequest.fingerprint !== hash || oldRequest.actor_id !== u.id)
                    throw Error('Request conflict.');
                return oldRequest.result;
            }
            const old = v.id ? await tx.prepare(`SELECT * FROM ${entity} WHERE id=? FOR UPDATE`).bind(v.id).first<{
                office_only: number;
            }>() : null;
            if (v.id && !old)
                throw Error('Profile no longer exists.');
            if (isOfficeRole(u.role) && (entity === 'artisans' || old && !old.office_only))
                throw Error('Office profiles only.');
            if (await tx.prepare(`SELECT id FROM ${entity} WHERE lower(trim(name))=lower(?) AND id::text<>?`).bind(name, v.id || '').first())
                throw Error('This name is already listed.');
            const id = v.id || randomUUID();
            if(entity==='inventory.art_styles') {
                await tx.prepare('INSERT INTO inventory.art_styles(id,name,created_by) VALUES(?::uuid,?,?)').bind(id,name,u.id).run();
            }
            else if (entity === 'artisans') {
                const works = Array.isArray(v.work_types) ? Array.from(new Set(v.work_types as string[])) : [];
                if (!works.length || works.length > 30 || works.some(w => typeof w !== 'string' || !w.trim() || w.length > 120))
                    throw Error('Choose one or more artwork names (up to 120 characters each).');
                if (works.includes('Others') && !v.work_description?.trim())
                    throw Error('Describe the other artwork.');
                if (old) {
                    const ids = artisanIdentity(v);
                    await tx.prepare("UPDATE artisans SET name=?,contact=?,address=?,work_type=?,work_types=?::text[],work_description=?,gst_no=coalesce(nullif(?,''),gst_no),pan_no=coalesce(nullif(?,''),pan_no),aadhaar_no=coalesce(nullif(?,''),aadhaar_no) WHERE id=?").bind(name, contact, address, works[0], '{' + works.map(w => JSON.stringify(w)).join(',') + '}', v.work_description || '', ids.gst, ids.pan, ids.aadhaar, id).run();
                }
                else {
                    const ids = artisanIdentity(v);
                    await tx.prepare('INSERT INTO artisans(id,name,contact,address,work_type,work_types,work_description,gst_no,pan_no,aadhaar_no) VALUES(?,?,?,?,?,?::text[],?,?,?,?)').bind(id, name, contact, address, works[0], '{' + works.map(w => JSON.stringify(w)).join(',') + '}', v.work_description || '', ids.gst, ids.pan, ids.aadhaar).run();
                }
                await tx.prepare(`WITH added AS (
                  INSERT INTO inventory.art_styles(name,created_by)
                  SELECT DISTINCT btrim(work),?::text FROM unnest(?::text[]) AS names(work)
                  ON CONFLICT DO NOTHING RETURNING id,name
                ) INSERT INTO inventory.change_audit(actor_id,actor,actor_role,action,target_label,after_data)
                  SELECT ?,?,?,'production_art_style_created',name,jsonb_build_object('id',id,'name',name,'source','artisan_profile') FROM added
                `).bind(u.id,'{'+works.map(w=>JSON.stringify(w)).join(',')+'}',u.id,u.name,roleLabel(u.role)).run();
            }
            else if (entity === 'companies') {
                if (old) {
                    if (!isManagement(u.role) && !isOfficeRole(u.role))
                        throw Error('Management access required.');
                    await tx.prepare('UPDATE companies SET name=?,contact=?,address=?,notes=? WHERE id=?').bind(name, contact, address, notes, id).run();
                }
                else {
                    const ownership = officeCreation ? 'EXTERNAL' : v.ownership || 'EXTERNAL';
                    if (!['OWN', 'EXTERNAL'].includes(ownership))
                        throw Error('Choose ownership.');
                    await tx.prepare('INSERT INTO companies(id,name,prefix,ownership,contact,address,notes,office_only) VALUES(?,?,?,?,?,?,?,?)').bind(id, name, id.replaceAll('-', '').slice(0, 8).toUpperCase(), ownership, contact, address, notes, officeCreation ? 1 : 0).run();
                }
            }
            else if (old)
                await tx.prepare('UPDATE products SET name=? WHERE id=?').bind(name, id).run();
            else
                await tx.prepare('INSERT INTO products(id,name,office_only) VALUES(?,?,?)').bind(id, name, officeCreation ? 1 : 0).run();
            await tx.prepare('INSERT INTO inventory.change_audit(actor_id,actor,actor_role,action,target_label,before_data,after_data) VALUES(?,?,?,?,?,?::text::jsonb,?::text::jsonb)').bind(u.id, u.name, roleLabel(u.role), entity==='inventory.art_styles'?'production_art_style_created':'production_profile_' + (old ? 'updated' : 'created'), name, JSON.stringify(old ? Object.fromEntries(Object.entries(old).filter(([k]) => !['gst_no', 'pan_no', 'aadhaar_no'].includes(k))) : null), JSON.stringify({ id, name, contact, address, notes })).run();
            const result = { ok: true, id };
            await tx.prepare('INSERT INTO inventory.production_requests(id,actor_id,fingerprint,result) VALUES(?,?,?,?::text::jsonb)').bind(v.key, u.id, hash, JSON.stringify(result)).run();
            return result;
        });
        return Response.json(result);
    }
    catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Could not save profile.' }, { status: 400 });
    }
}
