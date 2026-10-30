// Office-only journey integration checks run in one rolled-back transaction.
// Run: node --env-file=.env scripts/test-office-access.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import postgres from 'postgres';

const modules=new Map();
async function moduleUrl(path){const url=new URL(path,import.meta.url),cached=modules.get(url.href);if(cached)return cached;let source=await readFile(url,'utf8');if(/(['"])\.\/rules\1/.test(source)){const rulesUrl=await moduleUrl(new URL('./rules.ts',url));source=source.replace(/(['"])\.\/rules\1/g,()=>JSON.stringify(rulesUrl))}const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,result='data:text/javascript;base64,'+Buffer.from(code).toString('base64');modules.set(url.href,result);return result}
async function load(path){return import(await moduleUrl(path))}
const {officeOperation}=await load('../lib/office-server.ts');
const {postFinishOperation}=await load('../lib/post-finish.ts');
const {permitted,canManageUser}=await load('../lib/rules.ts');
const url=process.env.SUPABASE_DATABASE_URL||process.env.POSTGRES_URL||process.env.DATABASE_URL;
assert.ok(url,'Set the database URL before running integration checks.');
const sql=postgres(url,{max:1,prepare:false,ssl:'require',connect_timeout:15});
const tables=['companies','products','lots','pieces','piece_events','transactions','transaction_items','guards','print_jobs','exceptions'];
function statement(query){for(const table of tables)query=query.replace(new RegExp(`\\b(FROM|JOIN|INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`,'gi'),(_,keyword)=>`${keyword} inventory.${table}`);let index=0;return query.replace(/\?/g,()=>`$${++index}`)}
function database(tx){return{prepare(query){return{bind(...args){return{async first(){return(await tx.unsafe(statement(query),args))[0]||null},async all(){return{results:await tx.unsafe(statement(query),args)}}}}}}}}
let checks=0;const check=(value,message)=>{assert.ok(value,message);checks++};
const rollback=new Error('ROLLBACK_SUCCESSFUL_TEST');
try{
 await sql.begin(async tx=>{
  const id=()=>crypto.randomUUID(),time=new Date().toISOString(),actor='Office journey test';
  async function run(handler,op,v,options={}){return tx.savepoint(async step=>{
   const operationTime=options.time||time,user=options.user||{id:'office-test',role:'Office Manager',name:actor},operationActor=user.name||actor;
   const writes=[],db=database(step),add=(query,...args)=>writes.push(()=>step.unsafe(statement(query),args));
   const guard=(query,...args)=>{const gid=id();add(`INSERT INTO guards(id,ok) VALUES(?,CASE WHEN (${query}) THEN 1 ELSE 0 END)`,gid,...args);add('DELETE FROM guards WHERE id=?',gid)};
   const event=(p,type,before,after,reason,transactionId=null)=>add('INSERT INTO piece_events(id,piece_id,type,transaction_id,actor,created_at,reason,before_state,after_state) VALUES(?,?,?,?,?,?,?,?,?)',id(),p.id,type,transactionId,operationActor,operationTime,reason,before?JSON.stringify(before):null,JSON.stringify(after));
   const move=(p,type,after,reason,transactionId)=>{guard('SELECT COUNT(*)=1 FROM pieces WHERE id=? AND version=?',p.id,p.version);add('UPDATE pieces SET holder=?,artisan_id=?,ground_staff_id=?,condition=?,label_confirmed_at=?,version=version+1 WHERE id=?',after.holder,after.artisan_id||null,after.holder==='GROUND_STAFF'?after.ground_staff_id:null,after.condition,after.label_confirmed_at??p.label_confirmed_at,p.id);event(p,type,p,{...after,version:p.version+1},reason,transactionId);add('INSERT INTO transaction_items(id,transaction_id,piece_id,before_state,after_state) VALUES(?,?,?,?,?)',id(),transactionId,p.id,JSON.stringify(p),JSON.stringify({...p,...after,version:p.version+1}))};
   const transaction=(type,artisan,reason,lines)=>{const tid=id(),prefix=type==='OFFICE_VENDOR_INTAKE'?'ON':type==='OFFICE_LABEL_CONFIRM'?'OL':type==='OFFICE_SALE'?'SL':'OT',number=`${prefix}-${operationTime.slice(2,10).replaceAll('-','')}-${tid.slice(0,6).toUpperCase()}`;add('INSERT INTO transactions(id,number,type,artisan_id,status,reason,actor,created_at,snapshot,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)',tid,number,type,artisan,'CONFIRMED',reason,operationActor,operationTime,JSON.stringify(lines),user.id);return tid};
   const fail=(message,status=400)=>Object.assign(new Error(message),{status});
   const result=await handler({op,v,db,add,guard,event,move,transaction,user,actor:operationActor,time:operationTime,uuid:id,fail});
   for(const write of writes)await write();return result;
  })}
  check(permitted('Office Manager','officeEntry')&&!permitted('Office Manager','receipt')&&!permitted('Office Manager','handoff'),'Office Manager is office-only');
  check(permitted('Assistant Manager','officeEntry')&&!permitted('Assistant Manager','user'),'Assistant Manager operates office stock without access control');
  check(!permitted('Office Staff','officeEntry')&&permitted('Office Staff','officeReceive'),'Office Staff keeps scan-only office operations');
  check(canManageUser('Office Manager',null,'Office Staff')&&canManageUser('Office Manager','Assistant Manager','Office Staff')&&!canManageUser('Office Manager','Admin','Office Staff')&&!canManageUser('Office Manager',null,'Supervisor'),'Office Manager can grant only the two subordinate office roles');
  const marker=id().replaceAll('-','').slice(0,8),prefix=('O'+id().replace(/[^a-f]/g,'').slice(0,5)).toUpperCase();
  const created=await run(officeOperation,'officeNewEntry',{vendor_name:'Office Vendor '+marker,vendor_prefix:prefix,vendor_contact:'test',product_name:'Office Saree '+marker,material:'Cotton',color:'Blue',reference:'',received_at:time.slice(0,10),quantity:2,notes:'Rolled-back integration fixture'});
  check(created.codes.length===2&&new Set(created.codes).size===2,'Office New Entry creates unique permanent barcodes');
  let pieces=await tx`select * from inventory.pieces where lot_id=${created.lotId} order by code`;
  check(pieces.length===2&&pieces.every(p=>p.journey==='OFFICE'&&p.ownership==='EXTERNAL'&&p.holder==='OFFICE_PENDING'&&p.condition==='PENDING_LABEL_CONFIRMATION'&&!p.label_confirmed_at),'Outside-vendor barcodes remain pending and office-only until scanned');
  const lot=(await tx`select * from inventory.lots where id=${created.lotId}`)[0];
  check(lot.journey==='OFFICE'&&lot.reference==='','Office lot stays valid without a bill and is permanently marked as an office journey');
  check((await tx`select count(*)::int as n from inventory.print_jobs where codes=${JSON.stringify(created.codes)}`)[0].n===1,'Initial office label printing is audited');
  const entryValues={id:lot.id,reference:'',received_at:lot.received_at,notes:'Corrected office entry '+marker,reason:'Checked original office receipt',expected:{reference:lot.reference,received_at:lot.received_at,notes:lot.notes}};
  const edited=await run(officeOperation,'officeEntryEdit',entryValues);
  const editedLot=(await tx`select * from inventory.lots where id=${lot.id}`)[0];
  check(editedLot.reference===''&&editedLot.notes===entryValues.notes&&editedLot.journey==='OFFICE','Office entry metadata corrections accept an optional blank bill and retain the office journey');
  const afterEditPieces=await tx`select * from inventory.pieces where lot_id=${lot.id} order by code`;
  check(afterEditPieces.length===2&&afterEditPieces.every((piece,i)=>piece.code===pieces[i].code&&piece.version===pieces[i].version&&piece.condition===pieces[i].condition),'Entry correction does not change barcode count, identity or inventory state');
  const entryAudit=(await tx`select * from inventory.transactions where id=${edited.id}`)[0],entryAuditRow=JSON.parse(entryAudit.snapshot)[0];
  check(entryAudit.type==='OFFICE_ENTRY_EDIT'&&entryAuditRow.before.notes===lot.notes&&entryAuditRow.after.notes===entryValues.notes,'Office entry correction retains its before/after audit record');
  await assert.rejects(run(officeOperation,'officeEntryEdit',entryValues),/changed while you were editing/);
  const currentEntry={...entryValues,notes:'Another correction '+marker,expected:{reference:editedLot.reference,received_at:editedLot.received_at,notes:editedLot.notes}};
  await assert.rejects(run(officeOperation,'officeEntryEdit',currentEntry,{user:{id:'office-staff-test',role:'Office Staff',name:'Office staff test'}}),/cannot edit Office New Entries/);
  await assert.rejects(run(officeOperation,'officeEntryEdit',currentEntry,{time:new Date(Date.parse(time)+25*60*60*1000).toISOString()}),/24-hour/);
  const vendor=(await tx`select * from inventory.companies where id=${pieces[0].company_id}`)[0];
  const masterValues={kind:'vendors',id:vendor.id,name:'Corrected Office Vendor '+marker,contact:'Corrected office contact',reason:'Checked vendor details',expected:{name:vendor.name,contact:vendor.contact}};
  const masterEdited=await run(officeOperation,'officeMasterEdit',masterValues);
  const updatedVendor=(await tx`select * from inventory.companies where id=${vendor.id}`)[0];
  check(updatedVendor.name===masterValues.name&&updatedVendor.contact===masterValues.contact&&updatedVendor.office_only===1&&updatedVendor.prefix===vendor.prefix,'Office-only vendor metadata correction retains scope and permanent prefix');
  const masterAudit=(await tx`select * from inventory.transactions where id=${masterEdited.id}`)[0],masterAuditRow=JSON.parse(masterAudit.snapshot)[0];
  check(masterAudit.type==='OFFICE_MASTER_EDIT'&&masterAuditRow.before.name===vendor.name&&masterAuditRow.after.name===masterValues.name,'Office vendor correction retains a dated before/after audit record');
  await assert.rejects(run(officeOperation,'officeMasterEdit',masterValues),/changed while you were editing/);
  const currentMaster={...masterValues,name:'Another Office Vendor '+marker,expected:{name:updatedVendor.name,contact:updatedVendor.contact}};
  await assert.rejects(run(officeOperation,'officeMasterEdit',currentMaster,{user:{id:'office-staff-test',role:'Office Staff',name:'Office staff test'}}),/cannot edit office vendors or products/);
  await assert.rejects(run(officeOperation,'officeMasterEdit',{...currentMaster,prefix:updatedVendor.prefix==='ZZ'?'YY':'ZZ'}),/cannot change barcode prefixes/);
  await run(officeOperation,'officeLabel',{id:pieces[0].id,version:pieces[0].version});
  await run(officeOperation,'officeLabel',{id:pieces[1].id,version:pieces[1].version});
  pieces=await tx`select * from inventory.pieces where lot_id=${created.lotId} order by code`;
  check(pieces.every(p=>p.holder==='OFFICE_STOCK'&&p.condition==='FINISHED'&&p.label_confirmed_at&&p.version===2),'Attached-label scans activate outside-vendor office inventory');
  await assert.rejects(
   tx.savepoint(step=>step`update inventory.pieces set holder='IN_HOUSE', version=version+1 where id=${pieces[1].id}`),
   /Invalid factory or office custody state for this journey/
  );
  check((await tx`select holder from inventory.pieces where id=${pieces[1].id}`)[0].holder==='OFFICE_STOCK','Database guard blocks office-only stock from entering workshop custody');
  await assert.rejects(run(postFinishOperation,'officeReturn',{id:pieces[1].id,version:pieces[1].version,disputed:true,reason:'Must stay office-only'}),/office-only journey/);
  await run(postFinishOperation,'officeSell',{id:pieces[0].id,version:pieces[0].version});
  check((await tx`select holder from inventory.pieces where id=${pieces[0].id}`)[0].holder==='SOLD','Office-only stock can be sold without entering workshop inventory');
  check((await tx`select count(*)::int as n from inventory.transactions where snapshot like ${'%'+marker+'%'}`)[0].n===6,'New entry, metadata corrections, two label scans and sale remain in office journey history');
  console.log(`PASS: ${checks} office-access assertions plus rejection checks. All fixtures will roll back.`);
  throw rollback;
 });
}catch(error){if(error!==rollback)throw error}finally{await sql.end()}
