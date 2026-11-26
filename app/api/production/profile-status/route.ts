import {createHash} from 'node:crypto';
import {db} from '@/lib/database';
import {inventorySession} from '@/lib/inventory-identity';
import {isOwner,roleLabel} from '@/lib/rules';
export const dynamic='force-dynamic';
const reject=(message:string,status=400)=>Object.assign(Error(message),{status});
export async function POST(request:Request){
 try{
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)throw reject('Use the inventory site.',403);
  const {staff,signedIn}=await inventorySession();
  if(!signedIn||!staff||!isOwner(staff.role))throw reject('Only Owner can change company or artisan status.',403);
  const {key,...v}=await request.json();
  const table=v.kind==='company'?'companies':v.kind==='artisan'?'artisans':null;
  if(!table||typeof v.id!=='string'||!v.id)throw reject('Choose a company or artisan.');
  if(!['active','paused','archived','deleted'].includes(v.status))throw reject('Choose a valid profile status.');
  if(typeof v.reason!=='string'||!v.reason.trim()||v.reason.length>2000)throw reject('Enter a reason within 2,000 characters.');
  if(!/^[a-f\d-]{36}$/i.test(key||''))throw reject('Reload this form.');
  const fingerprint=createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const result=await db.transaction(async tx=>{
   await tx.prepare("SELECT pg_advisory_xact_lock(hashtextextended('production-posting',0))").run();
   if(!await tx.prepare('SELECT id FROM users WHERE id=? AND role=? AND active=1 FOR SHARE').bind(staff.id,staff.role).first())throw reject('Your access changed.',403);
   const previous=await tx.prepare('SELECT fingerprint,actor_id,result FROM inventory.production_requests WHERE id=?').bind(key).first<{fingerprint:string;actor_id:string;result:unknown}>();
   if(previous){if(previous.fingerprint!==fingerprint||previous.actor_id!==staff.id)throw reject('This request belongs to a different entry.',409);return previous.result;}
   const old=await tx.prepare(`SELECT id,name,active,profile_status FROM ${table} WHERE id=? FOR UPDATE`).bind(v.id).first<{id:string;name:string;active:number;profile_status:string}>();
   if(!old)throw reject('Profile no longer exists.',404);
   const active=v.status==='active'?1:0;
   await tx.prepare(`UPDATE ${table} SET active=?,profile_status=? WHERE id=?`).bind(active,v.status,v.id).run();
   await tx.prepare('INSERT INTO inventory.change_audit(actor_id,actor,actor_role,action,target_label,before_data,after_data) VALUES(?,?,?,?,?,?::text::jsonb,?::text::jsonb)').bind(staff.id,staff.name,roleLabel(staff.role),'production_profile_status',old.name,JSON.stringify({kind:v.kind,...old}),JSON.stringify({kind:v.kind,id:old.id,name:old.name,active,profile_status:v.status,reason:v.reason.trim()})).run();
   const result={ok:true,id:old.id,status:v.status,message:'Profile status updated. History, stock and money are preserved.'};
   await tx.prepare('INSERT INTO inventory.production_requests(id,actor_id,fingerprint,result) VALUES(?,?,?,?::text::jsonb)').bind(key,staff.id,fingerprint,JSON.stringify(result)).run();return result;
  });
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){if('code' in Object(e))console.error('Profile status database error:',(e as {code?:string}).code);return Response.json({error:e instanceof Error&&!('code' in e)?e.message:'Could not change profile status. Retry the same action.'},{status:(e as {status?:number}).status||('code' in Object(e)?503:400),headers:{'Cache-Control':'no-store'}});}
}
