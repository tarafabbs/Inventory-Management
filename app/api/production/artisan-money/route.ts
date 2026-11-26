import {createHash,randomUUID} from 'node:crypto';
import {db} from '@/lib/database';
import {inventorySession} from '@/lib/inventory-identity';
import {isManagement,isOfficeRole,isOwner,roleLabel} from '@/lib/rules';
import {artisanMoneyAmount,type ArtisanMoneyCommand} from '@/lib/artisan-money';
export const dynamic='force-dynamic';
const reject=(message:string,status=400)=>Object.assign(Error(message),{status});
export async function POST(request:Request){
 try{
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)throw reject('Use the inventory site.',403);
  const {staff,signedIn}=await inventorySession();
  if(!signedIn||!staff||isOfficeRole(staff.role)||!isManagement(staff.role))throw reject('Management access required.',403);
  const {key,...raw}=await request.json();const c=raw as ArtisanMoneyCommand;
  if(!/^[a-f\d-]{36}$/i.test(key||''))throw reject('Reload this form.');
  if((c.notes||'').length>4000||(c.reference||'').length>200)throw reject('Keep remarks within 4,000 characters and bill number within 200.');
  const fingerprint=createHash('sha256').update(JSON.stringify(c)).digest('hex');
  const result=await db.transaction(async tx=>{
   await tx.prepare("SELECT pg_advisory_xact_lock(hashtextextended('production-posting',0))").run();
   if(!await tx.prepare('SELECT id FROM users WHERE id=? AND active=1 AND role=? FOR SHARE').bind(staff.id,staff.role).first())throw reject('Your access changed.',403);
   const previous=await tx.prepare('SELECT fingerprint,actor_id,result FROM inventory.production_requests WHERE id=?').bind(key).first<{fingerprint:string;actor_id:string;result:unknown}>();
   if(previous){if(previous.fingerprint!==fingerprint||previous.actor_id!==staff.id)throw reject('This request belongs to a different entry.',409);return previous.result;}
   if(!await tx.prepare('SELECT id FROM artisans WHERE id=?').bind(c.artisan).first())throw reject('Choose an artist.');
   const current=await tx.prepare('SELECT coalesce(sum(amount),0)::float8 AS amount FROM inventory.artisan_money WHERE artisan=?').bind(c.artisan).first<{amount:number}>();
   let amount:number,reverse:string|null=null;
   if(c.kind==='reversal'){
    if(!isOwner(staff.role))throw reject('Only Owner can reverse an artisan money entry.',403);
    if(!c.notes?.trim())throw reject('Enter a reversal reason.');
    const old=await tx.prepare('SELECT id,amount::float8 AS amount,event_id,kind FROM inventory.artisan_money WHERE id=?::uuid AND artisan=? FOR UPDATE').bind(c.entry||'',c.artisan).first<{id:string;amount:number;event_id:string|null;kind:string}>();
    if(!old||old.event_id||old.kind==='reversal')throw reject('Correct a receipt charge from its stock receipt history.');
    if(await tx.prepare('SELECT id FROM inventory.artisan_money WHERE reversal_of=?::uuid').bind(old.id).first())throw reject('This entry is already reversed.',409);
    // Validate the date using the same calendar rules as any positive charge.
    artisanMoneyAmount({...c,kind:'charge',amount:1},current?.amount||0);
    amount=-old.amount;reverse=old.id;
   }else{
    amount=artisanMoneyAmount(c,current?.amount||0);
    if(c.kind==='opening'&&await tx.prepare('SELECT id FROM inventory.artisan_money WHERE artisan=? LIMIT 1').bind(c.artisan).first())throw reject('Enter artisan opening before regular money entries.');
    const opening=await tx.prepare("SELECT entry_date::text AS date FROM inventory.artisan_money WHERE artisan=? AND kind='opening'").bind(c.artisan).first<{date:string}>();
    if(opening&&c.date<opening.date)throw reject('Entry date precedes opening balance.');
   }
   const id=randomUUID();await tx.prepare('INSERT INTO inventory.artisan_money(id,artisan,entry_date,kind,amount,reference,notes,actor_id,actor,actor_role,reversal_of) VALUES(?::uuid,?,?::date,?,?,?,?,?,?,?,?::uuid)').bind(id,c.artisan,c.date,c.kind,amount,c.reference||'',c.notes||'',staff.id,staff.name,roleLabel(staff.role),reverse).run();
   const result={ok:true,id,message:'Saved. Artisan account updated.'};
   await tx.prepare('INSERT INTO inventory.production_requests(id,actor_id,fingerprint,result) VALUES(?,?,?,?::text::jsonb)').bind(key,staff.id,fingerprint,JSON.stringify(result)).run();return result;
  });
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error&&!('code'in e)?e.message:'Could not save artisan money. Retry the same entry.'},{status:(e as {status?:number}).status||('code'in Object(e)?503:400),headers:{'Cache-Control':'no-store'}});}
}
