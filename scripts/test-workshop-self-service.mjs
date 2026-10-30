// Workshop self-service contracts: no database connection or persistent writes.
// Run: node scripts/test-workshop-self-service.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const modules=new Map();
async function moduleUrl(path){
 const url=new URL(path,import.meta.url),cached=modules.get(url.href);
 if(cached)return cached;
 let source=await readFile(url,'utf8');
 if(/(['"])\.\/rules\1/.test(source)){
  const rules=await moduleUrl(new URL('./rules.ts',url));
  source=source.replace(/(['"])\.\/rules\1/g,()=>JSON.stringify(rules));
 }
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const result='data:text/javascript;base64,'+Buffer.from(code).toString('base64');
 modules.set(url.href,result);return result;
}
const {assignPurchaseSource}=await import(await moduleUrl('../lib/purchase-source.ts'));
const {intakeOperation}=await import(await moduleUrl('../lib/intake-server.ts'));
const time='2026-10-30T12:00:00Z',source={id:'thanwala-1',name:'Verified purchase source',active:1};
let checks=0;
const check=(condition,message)=>{assert.ok(condition,message);checks++};
const fail=(message,status=400)=>Object.assign(new Error(message),{status});

function recorder(){
 const statements=[],guards=[],events=[],transactions=[],queries=[];
 return {statements,guards,events,transactions,queries,
  add:(query,...args)=>statements.push({query,args}),
  guard:(query,...args)=>guards.push({query,args}),
  event:(piece,type,before,after,reason,transactionId)=>events.push({piece,type,before,after,reason,transactionId}),
  transaction:(type,artisan,reason,lines)=>{const id='transaction-'+(transactions.length+1);transactions.push({id,type,artisan,reason,lines});return id},
  user:{id:'operator-1',name:'Workshop operator',role:'Supervisor'},actor:'Workshop operator',time,uuid:()=>crypto.randomUUID(),fail,
 };
}

function purchaseContext({role='Supervisor',piecePatch={},lotPatch={},siblingPatch={},valuePatch={},activeSource=source,labelConflict=0}={}){
 const record=recorder();
 const piece={id:'piece-1',code:'TF-000001',lot_id:'lot-1',journey:'FACTORY',ownership:'OWN',holder:'IN_HOUSE',condition:'DISPUTED',thanwala_id:null,version:3,...piecePatch};
 const sibling={...piece,id:'piece-2',code:'TF-000002',version:8,...siblingPatch};
 const alreadyIdentified={...piece,id:'piece-3',code:'TF-000003',version:4,thanwala_id:source.id};
 const lot={id:'lot-1',number:'LOT-LEGACY-1',journey:'FACTORY',ownership:'OWN',thanwala_id:null,...lotPatch};
 const db={prepare(query){return{bind(...args){record.queries.push({query,args});return{
  async first(){
   if(query==='SELECT * FROM pieces WHERE id=?')return args[0]===piece.id?piece:null;
   if(query==='SELECT * FROM thanwalas WHERE id=? AND active=1')return activeSource&&args[0]===activeSource.id?activeSource:null;
   if(query==='SELECT * FROM lots WHERE id=?')return args[0]===lot.id?lot:null;
   if(query.startsWith('SELECT COUNT(*)::int AS n FROM generated_labels'))return {n:labelConflict};
   throw Error('Unexpected purchase-source query: '+query);
  },
  async all(){assert.equal(query,'SELECT * FROM pieces WHERE lot_id=?');return{results:[piece,sibling,alreadyIdentified]};},
 }}}}};
 return {...record,db,piece,sibling,lot,user:{...record.user,role},op:'assignThanwala',v:{id:piece.id,version:piece.version,thanwala_id:source.id,verified:true,reason:'Physical purchase bill and saree checked.',...valuePatch}};
}

const purchase=purchaseContext();
const assigned=await assignPurchaseSource(purchase);
check(assigned.ok&&assigned.count===2&&assigned.source===source.name,'A verified legacy lot assigns its missing purchase source once');
check(purchase.statements[0].query==='SELECT id FROM lots WHERE id=? FOR UPDATE','Purchase source assignment locks the lot before staged writes');
const sourceWrites=purchase.statements.filter(write=>write.query.startsWith('UPDATE pieces'));
check(sourceWrites.length===2&&sourceWrites.every(write=>write.query==='UPDATE pieces SET thanwala_id=?,version=version+1 WHERE id=? AND thanwala_id IS NULL'&&write.args[0]===source.id),'Only pieces without a saved source receive source and version updates');
check(purchase.statements.some(write=>write.query.startsWith('UPDATE lots SET thanwala_id='))&&purchase.statements.some(write=>write.query.startsWith('UPDATE generated_labels SET thanwala_id=')),'Lot and pending barcode reservation sources are staged together');
check(purchase.events.length===2&&purchase.events.every(event=>event.type==='PURCHASE_SOURCE_ASSIGNED'&&event.after.thanwala_id===source.id&&event.after.version===event.before.version+1),'Every affected piece keeps a dated audit event with incremented version');
check(purchase.events.every(event=>event.before.code===event.after.code&&event.before.holder===event.after.holder&&event.before.condition===event.after.condition),'Source identification preserves barcode, custody and inspection condition');
check(purchase.transactions.length===1&&purchase.transactions[0].type==='PURCHASE_SOURCE_ASSIGNED'&&purchase.transactions[0].lines.length===2&&purchase.transactions[0].reason.includes(source.name),'Purchase source assignment records its exact affected pieces and physical evidence');
check(purchase.guards.some(guard=>guard.query.includes('version=? AND thanwala_id IS NULL')&&guard.args[1]===purchase.piece.version),'Source assignment guards the scanned piece version and missing-source state');

async function purchaseRejected(options,pattern,message){
 const context=purchaseContext(options);
 await assert.rejects(assignPurchaseSource(context),pattern);
 check(context.statements.length===0&&context.events.length===0&&context.transactions.length===0,message);
}
await purchaseRejected({role:'Office Manager'},/cannot identify workshop purchase sources/,'Office access cannot identify workshop purchase sources');
await purchaseRejected({role:'Viewer'},/cannot identify workshop purchase sources/,'Read-only access cannot identify a purchase source');
await purchaseRejected({piecePatch:{holder:'OFFICE_STOCK'}},/within workshop custody/,'A product currently held at Office cannot be changed through workshop source assignment');
await purchaseRejected({piecePatch:{journey:'OFFICE'}},/within workshop custody/,'Office-only products never acquire a workshop purchase source');
await purchaseRejected({piecePatch:{ownership:'EXTERNAL'}},/within workshop custody/,'Jobwork-company stock cannot become a Thanwala purchase');
await purchaseRejected({piecePatch:{thanwala_id:source.id}},/already has its purchase source saved/,'One-time identification cannot replace even an identical saved source');
await purchaseRejected({lotPatch:{thanwala_id:'different-source'}},/must match the original Own Product lot/,'An existing lot source cannot be replaced');
await purchaseRejected({lotPatch:{journey:'OFFICE'}},/must match the original Own Product lot/,'Office-only lots are outside workshop source identification');
await purchaseRejected({siblingPatch:{thanwala_id:'different-source'}},/lot already contains a different saved purchase source/,'Conflicting source evidence anywhere in the lot blocks assignment');
await purchaseRejected({labelConflict:1},/lot already contains a different saved purchase source/,'A conflicting saved label source blocks assignment too');
await purchaseRejected({valuePatch:{verified:false}},/Verify the original purchase source/,'Physical source verification is required');
await purchaseRejected({valuePatch:{reason:'short'}},/10–2000 characters/,'Insufficient source evidence is rejected');
await purchaseRejected({valuePatch:{version:2}},/barcode changed/,'A stale scanned piece version blocks source assignment');
await purchaseRejected({activeSource:null},/Choose an active Thanwala/,'An unavailable Thanwala cannot be assigned');
check(await assignPurchaseSource({...purchaseContext(),op:'unrelated'})===null,'The source handler does not intercept unrelated operations');

function intakeContext({reservationState='AVAILABLE',legacyVersion=7,legacyExists=true}={}){
 const record=recorder();
 const label={id:'piece-1',code:'TF-000001',lot_id:'lot-1',company_id:'company-1',product_id:'product-1',ownership:'OWN',thanwala_id:source.id,state:reservationState};
 const legacy=legacyExists?{...label,state:undefined,holder:'IN_HOUSE',condition:'PENDING_LABEL_CONFIRMATION',version:legacyVersion,label_confirmed_at:null}:null;
 const db={prepare(query){return{bind(...args){record.queries.push({query,args});return{async first(){
  if(query.includes('FROM generated_labels g JOIN'))return args[0]===label.id?label:null;
  if(query.includes('FROM pieces g JOIN')&&query.includes("g.condition='PENDING_LABEL_CONFIRMATION'"))return args[0]===label.id?legacy:null;
  throw Error('Unexpected intake query: '+query);
 }}}}}};
 return {...record,db,label,legacy,op:'intake',v:{lot_id:label.lot_id,lines:[{id:label.id,outcome:'OK',source:'scanner'}]}};
}

const restored=intakeContext();
const reaccepted=await intakeOperation(restored);
check(reaccepted.ok&&reaccepted.count===1,'A previously undone intake can be accepted again from its existing pending piece');
check(restored.queries.some(query=>query.query.includes('FROM pieces g JOIN')),'An old AVAILABLE reservation falls back to its pending registered piece');
check(!restored.statements.some(write=>write.query.startsWith('INSERT INTO pieces')),'Re-acceptance never inserts a duplicate permanent piece');
check(restored.statements.some(write=>write.query==='UPDATE pieces SET condition=?,label_confirmed_at=?,version=version+1 WHERE id=?'&&write.args[0]==='AVAILABLE'&&write.args[2]===restored.legacy.id),'Re-acceptance updates only the existing piece and advances its version');
check(restored.events.length===1&&restored.events[0].before===restored.legacy&&restored.events[0].after.version===8&&restored.events[0].after.condition==='AVAILABLE','Re-acceptance history records the restored pending state and exact incremented version');
const restoredItem=restored.statements.find(write=>write.query.startsWith('INSERT INTO transaction_items'));
check(JSON.parse(restoredItem.args[3]).version===7&&JSON.parse(restoredItem.args[4]).version===8,'Re-acceptance transaction snapshots retain before and after versions for the next safe correction');
check(restored.guards.some(guard=>guard.query.includes("version=? AND condition='PENDING_LABEL_CONFIRMATION'")&&guard.args[1]===7),'Re-acceptance guards the current pending piece version');

const fresh=intakeContext({reservationState:'PENDING',legacyExists:false});
const entered=await intakeOperation(fresh);
check(entered.ok&&entered.count===1,'A fresh prepared barcode can enter inventory');
check(fresh.statements.filter(write=>write.query.startsWith('INSERT INTO pieces')).length===1,'First intake inserts exactly one permanent piece');
check(!fresh.queries.some(query=>query.query.includes('FROM pieces g JOIN')),'A fresh pending reservation does not use the legacy-piece fallback');
check(fresh.events.length===1&&fresh.events[0].before===null&&fresh.events[0].after.version===1,'First intake history starts at piece version one');
const freshItem=fresh.statements.find(write=>write.query.startsWith('INSERT INTO transaction_items'));
check(JSON.parse(freshItem.args[3])===null&&JSON.parse(freshItem.args[4]).version===1,'First intake transaction snapshots allow future pending-label restoration without losing its identity');
check(fresh.statements.some(write=>write.query==='UPDATE generated_labels SET state=?,registered_at=? WHERE id=?'&&write.args[0]==='AVAILABLE'),'First intake marks the reservation entered');
await assert.rejects(intakeOperation(intakeContext({legacyExists:false})),/unknown or already entered/);
checks++;
console.log(`PASS: ${checks} workshop source-identification and intake-recovery assertions. No database writes.`);
