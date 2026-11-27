// Real PostgreSQL posting tests. Every fixture and schema change is rolled back.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';import postgres from 'postgres';import {randomUUID} from 'node:crypto';
const source=async p=>readFile(new URL(p,import.meta.url),'utf8');const load=async text=>import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const prod=await load(await source('../lib/production.ts'));const rules=await load(await source('../lib/rules.ts'));
globalThis.__prod=prod;globalThis.__rules=rules;
const sql=postgres(process.env.SUPABASE_DATABASE_URL||process.env.POSTGRES_URL||process.env.DATABASE_URL,{ssl:'require',max:1,prepare:false});let checks=0;
try{await sql.begin(async tx=>{
 if(!(await tx`select to_regclass('inventory.production_events') as t`)[0].t)await tx.unsafe(await source('../supabase/migrations/20261124204531_production_accounts.sql'));
 if(!(await tx`select to_regclass('inventory.artisan_money') as t`)[0].t)await tx.unsafe(await source('../supabase/migrations/20261126102811_artisan_financial_statements.sql'));
 if(!(await tx`select 1 from information_schema.columns where table_schema='inventory' and table_name='companies' and column_name='profile_status'`).length)await tx.unsafe(await source('../supabase/migrations/20261126133758_profile_lifecycle_controls.sql'));
 if(!(await tx`select to_regclass('inventory.art_styles') as t`)[0].t)await tx.unsafe(await source('../supabase/migrations/20261126211501_shared_art_style_catalogue.sql'));
 const [owner]=await tx`select id,name,role from inventory.users where role='Admin' and active=1 limit 1`;assert.ok(owner);
 globalThis.__identity={signedIn:true,staff:owner};
 const wrapper=client=>({prepare(query){let n=0;query=query.replace(/\b(FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+(companies|products|artisans|settings|users)\b/gi,'$1 inventory.$2').replace(/\?/g,()=>'$'+(++n));const stmt=args=>({bind:(...args)=>stmt(args),first:async()=>((await client.unsafe(query,args))[0]||null),all:async()=>({results:await client.unsafe(query,args)}),run:async()=>client.unsafe(query,args)});return stmt([]);},transaction:fn=>client.savepoint(inner=>fn(wrapper(inner)))});
 globalThis.__db=wrapper(tx);
 let api=await source('../app/api/production/route.ts');api=api.replace(/import \{\s*db\s*\} from '@\/lib\/database';/, 'const db=globalThis.__db;').replace(/import \{\s*inventorySession\s*\} from '@\/lib\/inventory-identity';/,'const inventorySession=async()=>globalThis.__identity;').replace(/import \{[^;]+\} from '@\/lib\/rules';/,'const {isManagement,isOfficeRole,isOwner,permitted,roleLabel}=globalThis.__rules;').replace(/import \{[^;]+\} from '@\/lib\/production';/,'const {actions,accountKey,planCommand}=globalThis.__prod;');
 globalThis.__snapshot=await load((await source('../lib/production-snapshot.ts')).replace("import {db} from './database';",'const db=globalThis.__db;'));
 api=api.replace(/import \{productionSnapshot\} from '@\/lib\/production-snapshot';/,'const {productionSnapshot}=globalThis.__snapshot;');
 const {POST,GET}=await load(api);
 const company=randomUUID(),own=randomUUID(),product=randomUUID(),artist=randomUUID();
 await tx`insert into inventory.companies(id,name,prefix,ownership) values(${company},'Test Company','TC','EXTERNAL'),(${own},'Test Own','TO','OWN')`;
 await tx`insert into inventory.products(id,name) values(${product},'Test Silk')`;
 await tx`insert into inventory.artisans(id,name,work_type,work_types) values(${artist},'Test Artist','Free Hand Paint',array['Free Hand Paint','Block Print'])`;
 const date=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});const account=(stage,arts='',work='',artisan='',pool='normal',co=company)=>({company:co,product,pool,stage,arts,work,artisan});
 const send=async(c,status=200,key=randomUUID())=>{const r=await POST(new Request('https://im.tarafabbs.com/api/production',{method:'POST',headers:{'Content-Type':'application/json',origin:'https://im.tarafabbs.com'},body:JSON.stringify({date,...c,key})}));const body=await r.json();assert.equal(r.status,status,JSON.stringify(body));checks++;return body;};
 const q=async a=>Number((await tx`select quantity from inventory.production_balances where key=${prod.accountKey(a)}`)[0]?.quantity||0);
 if(process.env.IMS_TEST_OFFICE_TRANSFER_ONLY==='1'){
  const ready=account('ready','','','','normal',own),officeStock=account('office_stock','','','','normal',own),hold=account('hold','','','','normal',own);
  const officeUser={id:randomUUID(),name:'Test Office Staff',role:'Office Staff'};
  await tx`insert into inventory.users(id,email,name,role,active,created_at) values(${officeUser.id},${officeUser.id+'@example.test'},${officeUser.name},${officeUser.role},1,${new Date().toISOString()})`;
  await tx`insert into inventory.production_balances(key,company,product,pool,stage,artisan,arts,work,quantity) values(${prod.accountKey(ready)},${own},${product},'normal','ready','','','',8)`;
  globalThis.__identity={signedIn:true,staff:officeUser};
  const office=await (await GET(new Request('https://im.tarafabbs.com/api/production?view=office'))).json();
  assert.deepEqual(office.balances.filter(b=>b.stage==='ready').map(b=>b.quantity),[8]);
  await send({kind:'office_receive',company:own,lines:[{source:ready,quantity:6}]});
  assert.equal(await q(ready),2);assert.equal(await q(officeStock),6);
  await send({kind:'office_return',company:own,lines:[{source:officeStock,quantity:2}]});
  assert.equal(await q(ready),4);assert.equal(await q(officeStock),4);
  await send({kind:'office_dispute_return',company:own,notes:'Colour mismatch',lines:[{source:officeStock,quantity:1}]});
  assert.equal(await q(hold),1);assert.equal(await q(officeStock),3);
  await send({kind:'office_receive',company,lines:[{source:account('raw'),quantity:1}]},400);
  console.log('PASS: office pulls own ready stock; fresh return restores ready; disputed return enters factory hold; other company blocked. Checks:',checks);throw Error('ROLLBACK_TEST');
 }
 if(process.env.IMS_TEST_RESET_OPENING_ONLY==='1'){
  const yesterday=new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  const older=new Date(Date.parse(date+'T00:00:00Z')-4*86400000).toISOString().slice(0,10);
  const raw=account('raw'),ownRaw=account('raw','','','','normal',own);
  await tx`insert into inventory.production_events(id,kind,company,event_date,actor_id,actor,actor_role,payload,delta) values(${randomUUID()},'receipt',${company},${older},${owner.id},${owner.name},'Owner','{}'::jsonb,${JSON.stringify([{...raw,quantity:5}])}::text::jsonb)`;
  await tx`insert into inventory.settings(key,value) values('production_opening_date',${older}) on conflict(key) do update set value=excluded.value`;
  await tx`insert into inventory.production_events(id,kind,company,event_date,actor_id,actor,actor_role,payload,delta) values(${randomUUID()},'reset',${company},${yesterday},${owner.id},${owner.name},'Owner','{}'::jsonb,'[]'::jsonb)`;
  await send({kind:'receipt',company:own,lines:[{company:own,product,quantity:2}]});
  const snapshot=await (await GET(new Request('https://im.tarafabbs.com/api/production'))).json();
  assert.equal(snapshot.openingDate,yesterday,'Suggest the day before the first post-reset stock movement');
  const baseline={kind:'opening',confirm:true,date:yesterday,company,lines:[{source:raw,quantity:3}]};
  await send({...baseline,date},400);
  await send(baseline);
  assert.equal(await q(raw),3);
  await send(baseline,400);
  assert.equal((await (await GET(new Request('https://im.tarafabbs.com/api/production'))).json()).openingDate,yesterday);
  assert.equal(await q(ownRaw),2);
  console.log('PASS: reset-scoped opening ignores earlier history and stale settings, suggests prior day, rejects late and duplicate opening; fixtures rolled back. Checks:',checks);throw Error('ROLLBACK_TEST');
 }
 if(process.env.IMS_TEST_DIRECT_SALES_ONLY==='1'){
  if(!(await tx`select to_regclass('inventory.sales_documents') as t`)[0].t)await tx.unsafe(await source('../supabase/migrations/20261126232422_tarafabbs_direct_sales.sql'));
  globalThis.__salesCore=await load((await source('../lib/direct-sales.ts')).replace("import type { Account, Delta } from './production';",''));
  globalThis.__salesRead=await load((await source('../lib/sales-read.ts')).replace("import { db } from './database';",'const db=globalThis.__db;').replace(/import \{ blankLayout,[^;]+\} from '\.\/direct-sales';/,'const {blankLayout}=globalThis.__salesCore;'));
  globalThis.__salesWrite=await load((await source('../lib/sales-write.ts')).replace("import { accountKey, type Account, type Delta } from './production';",'const {accountKey}=globalThis.__prod;').replace("import { isOwner, roleLabel } from './rules';",'const {isOwner,roleLabel}=globalThis.__rules;').replace(/import \{\s*blankLayout[\s\S]+?\} from '\.\/direct-sales';/,'const {blankLayout,calculateSale,cents,dateValue,documentNumber,fiscalYear,gstNumber,netStock,rate,saleStages,seriesFor,units}=globalThis.__salesCore;'));
  let salesApiSource=await source('../app/api/production/direct-sales/route.ts');salesApiSource=salesApiSource.replace("import { db } from '@/lib/database';",'const db=globalThis.__db;').replace("import { inventorySession } from '@/lib/inventory-identity';",'const inventorySession=async()=>globalThis.__identity;').replace("import { isManagement } from '@/lib/rules';",'const {isManagement}=globalThis.__rules;').replace(/import \{ bookingCount,[^;]+\} from '@\/lib\/sales-read';/,'const {bookingCount,customerReturns,jobAdvances,salesDocument,salesHub,salesStatement}=globalThis.__salesRead;').replace("import { rejectSales, salesMutation } from '@/lib/sales-write';",'const {rejectSales,salesMutation}=globalThis.__salesWrite;');
  const salesApi=await load(salesApiSource);
  const postSales=async(v,status=200,key=randomUUID())=>{const response=await salesApi.POST(new Request('https://im.tarafabbs.com/api/production/direct-sales',{method:'POST',headers:{origin:'https://im.tarafabbs.com'},body:JSON.stringify({key,...v})}));const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));checks++;return body;};
  const getSales=async(view='',params={})=>{const response=await salesApi.GET(new Request('https://im.tarafabbs.com/api/production/direct-sales'+(view?'?'+new URLSearchParams({view,...params}):'')));const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));checks++;return body;};
  const stock=account('ready','Painted','','','normal',own),raw=account('raw','','','','normal',own);
  await send({kind:'receipt',company:own,lines:[{company:own,product,quantity:20}]});
  await tx`insert into inventory.production_balances(key,company,product,pool,stage,artisan,arts,work,quantity) values(${prod.accountKey(stock)},${own},${product},'normal','ready','','Painted','',10)`;
  const customerId=(await postSales({op:'customer',name:'Retail Example',address:'Sample address',phone:'0123456789'})).id;
  const productId=(await postSales({op:'product',name:'Test Silk',price:250,hsn:'5007',sku:'S1',stockProduct:product})).id;
  const catalogueId=(await postSales({op:'product',name:'Gift Box',price:25,sku:'BOX'})).id;
  assert.equal((await getSales()).products.find(p=>p.id===productId).price,25000);
  await postSales({op:'opening',customer:customerId,date,amount:100,direction:'due'});
  const booking=await postSales({op:'document',kind:'booking',customer:customerId,date,lines:[{source:prod.accountKey(stock),quantity:2,unit:250}],received:50,method:'Cash'});
  assert.equal(await q(stock),10,'Booking must not debit stock');
  assert.equal((await getSales()).balances.find(x=>x.customer===customerId).due,5000,'Booking advance is a credit on receipt date');
  const sale={op:'document',kind:'bill',customer:customerId,date,bookingId:booking.id,lines:[{source:prod.accountKey(stock),quantity:2,unit:250},{source:prod.accountKey(raw),quantity:1,unit:100},{product:catalogueId,quantity:2,unit:25}],discount:10,additional:5,received:250,method:'UPI'};
  const first=await postSales(sale),bill=await getSales('document',{id:first.id});
  assert.match(first.number,/^S-\d\d-0001$/);assert.equal(bill.total,64500);assert.equal(bill.paid,30000);
  assert.equal(await q(stock),8);assert.equal(await q(raw),19);
  assert.equal((await getSales()).balances.find(x=>x.customer===customerId).due,44500);
  const booked=await getSales('document',{id:booking.id});await postSales({op:'document',id:booking.id,revision:booked.revision,kind:'booking',customer:customerId,date,lines:[{source:prod.accountKey(stock),quantity:2,unit:250}],received:55,method:'Cash'},400);
  await postSales(sale,400,'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
  const shortage={...sale,bookingId:undefined,lines:[{source:prod.accountKey(stock),quantity:100,unit:250}]};await postSales(shortage,409);assert.equal(await q(stock),8);
  const gstCustomer=(await postSales({op:'customer',name:'GST Example',address:'GST address',gst:'19AAAAA0000A1Z5'})).id;
  await postSales({op:'layout',seller:'TaraFabbs',address:'Seller address',gst:'19AAAAA0000A1Z5',phone:'',bankName:'State Bank of India',accountNumber:'001234567890',ifsc:'SBIN0000001',branch:'KOLKATA MAIN',logo:'',signature:'',qr:''});
  await postSales({op:'layout',seller:'TaraFabbs',bankName:'State Bank of India',accountNumber:'123',ifsc:'SBIN0000001',branch:'KOLKATA MAIN'},400);
  await postSales({op:'document',kind:'bill',customer:gstCustomer,date,gst:true,gstNumber:'19AAAAA0000A1Z5',address:'GST address',place:'West Bengal',cgst:2.5,sgst:2.5,taxMode:'local',lines:[{source:prod.accountKey(stock),quantity:1,unit:200,hsn:''}],received:0},400);
  const gstBill=await postSales({op:'document',kind:'bill',customer:gstCustomer,date,gst:true,gstNumber:'19AAAAA0000A1Z5',address:'GST address',place:'West Bengal',cgst:2.5,sgst:2.5,taxMode:'local',lines:[{source:prod.accountKey(stock),quantity:1,unit:200,hsn:'5407'}],received:0});assert.match(gstBill.number,/^G-\d\d-0001$/);const gstDoc=await getSales('document',{id:gstBill.id});assert.equal(gstDoc.total,21000);assert.equal(gstDoc.body.layout.accountNumber,'001234567890');assert.equal(gstDoc.body.layout.branch,'KOLKATA MAIN');assert.equal(gstDoc.body.lines[0].hsn,'5407');
  const returnOptions=await getSales('returns',{customer:customerId});const sold=returnOptions.find(x=>x.number===first.number&&x.line.source?.stage==='ready');assert.equal(sold.remaining,2);
  const returned=await postSales({op:'document',kind:'return',customer:customerId,date,lines:[{returnFrom:sold.id,type:'return',quantity:1,unit:200}],received:50,method:'Cash'});assert.equal(await q(stock),8,'One sale and one linked return offset one piece');
  assert.equal((await getSales()).balances.find(x=>x.customer===customerId).due,29500);
  await postSales({op:'document',kind:'return',customer:customerId,date,lines:[{returnFrom:sold.id,type:'return',quantity:2,unit:200}],received:0},400);
  await postSales({op:'void',id:first.id,revision:bill.revision,confirm:true},400);
  const returnDoc=await getSales('document',{id:returned.id});await postSales({op:'void',id:returnDoc.id,revision:returnDoc.revision,confirm:true});assert.equal(await q(stock),7);
  await postSales({op:'void',id:first.id,revision:bill.revision,confirm:true});assert.equal(await q(stock),9);assert.equal(await q(raw),20);
  const finalHub=await getSales();assert.equal(finalHub.balances.find(x=>x.customer===customerId).due,5000,'Cancelled bill keeps cash booking advance as customer credit');
  const ledger=await getSales('statement',{customer:customerId});assert.ok(ledger.some(x=>x.label.startsWith('Booking advance')&&x.amount===-5000));
  await postSales({op:'payment',customer:customerId,date,amount:30,direction:'refund',method:'Cash'});assert.equal((await getSales()).balances.find(x=>x.customer===customerId).due,8000);
  globalThis.__identity={signedIn:true,staff:{...owner,role:'Office Staff'}};const denied=await salesApi.GET(new Request('https://im.tarafabbs.com/api/production/direct-sales'));assert.equal(denied.status,403);checks++;
  console.log('PASS: Direct Sell migration/API: serials, GST, linked and manual products, stock, booking credit, bill/return, due, refund, edit guards, void, permissions; checks:',checks);throw Error('ROLLBACK_TEST');
 }
 if(process.env.IMS_TEST_DASHBOARD_ONLY==='1'){
  globalThis.__dashboard=await load(await source('../lib/production-dashboard.ts'));
  const route=(await source('../app/api/production/dashboard/route.ts'))
   .replace("import { db } from '@/lib/database';",'const db=globalThis.__db;')
   .replace("import { inventorySession } from '@/lib/inventory-identity';",'const inventorySession=async()=>globalThis.__identity;')
   .replace(/import [^;]+ from '@\/lib\/production-dashboard';/,'const {companyPaymentPerformance,stockMetrics}=globalThis.__dashboard;')
   .replace("import { isManagement, isOfficeRole, permitted } from '@/lib/rules';",'const {isManagement,isOfficeRole,permitted}=globalThis.__rules;');
  const dashboard=await load(route);
  const get=async(query,status=200)=>{const r=await dashboard.GET(new Request('https://im.tarafabbs.com/api/production/dashboard?'+query));const b=await r.json();assert.equal(r.status,status,b.error);checks++;return b;};
  const ago=n=>new Date(Date.parse(date)-n*86400000).toISOString().slice(0,10);
  const [fixture]=await tx`select (now() at time zone 'Asia/Kolkata')::date::text as day`;
  assert.equal(fixture.day,date);
  const raw=account('raw'),artistStock=account('artist','','Free Hand Paint',artist);
  const ready=account('ready','Free Hand Paint');
  const opening={...raw,quantity:20},recent={...raw,quantity:100},sent={...artistStock,quantity:50};
  const insertEvent=async(kind,days,delta,payload={})=>{const id=randomUUID();await tx`insert into inventory.production_events(id,kind,company,event_date,actor_id,actor,actor_role,payload,delta) values(${id},${kind},${company},${ago(days)},${owner.id},'Test Owner','Owner',${JSON.stringify(payload)}::text::jsonb,${JSON.stringify(delta)}::text::jsonb)`;return id;};
  const balance=async(a,n)=>tx`insert into inventory.production_balances(key,company,product,pool,stage,artisan,arts,work,quantity) values(${prod.accountKey(a)},${a.company},${a.product},${a.pool},${a.stage},${a.artisan},${a.arts},${a.work},${n})`;
  const baseline={};for(const k of ['on_site','with_artists','custody','ready'])baseline[k]=await get('metric='+k+'&period=recent');
  await insertEvent('receipt',35,[opening]);
  await insertEvent('receipt',23,[recent]);
  const removed=await insertEvent('receipt',2,[{...raw,quantity:5}]);
  await insertEvent('delete',1,[{...raw,quantity:-5}],{document:removed});
  await insertEvent('issue',17,[{...raw,quantity:-50},sent]);
  await insertEvent('receive',2,[{...artistStock,quantity:-10},{...ready,quantity:10}]);
  const billOne=await insertEvent('dispatch',28,[]);
  const billTwo=await insertEvent('dispatch',7,[]);
  const paid=await insertEvent('payment',8,[]);
  await tx`insert into inventory.production_money(event_id,company,kind,amount) values(${billOne},${company},'bill',20000),(${billTwo},${company},'bill',10000),(${paid},${company},'payment',-15000)`;
  const corrected=await insertEvent('correct',8,[],{document:paid,correctionKind:'payment',effectiveMoney:[{company,kind:'payment',amount:-12000}]});
  await tx`insert into inventory.production_money(event_id,company,kind,amount) values(${corrected},${company},'correction',15000),(${corrected},${company},'payment',-12000)`;
  await balance(raw,70);await balance(artistStock,40);await balance(ready,10);
  for(const [metric,current,atOpening] of [['on_site',80,20],['with_artists',40,0],['custody',120,20],['ready',10,0]]){
   const row=await get('metric='+metric+'&period=recent'),old=baseline[metric];assert.equal(row.current-old.current,current);assert.equal(row.opening-old.opening,atOpening);
   assert.equal(row.opening+row.movements.reduce((n,m)=>n+m.added-m.removed,0),row.current);
   if(metric==='on_site')assert.equal(row.movements.find(m=>m.kind==='issue').removed-(old.movements.find(m=>m.kind==='issue')?.removed||0),50);
   if(metric==='custody')assert.deepEqual(row.movements.find(m=>m.kind==='issue'),old.movements.find(m=>m.kind==='issue'));
  }
  const perf=await get('mode=performance');
  assert.deepEqual(perf.stock.filter(b=>b.company===company).map(b=>[b.stage,b.quantity,b.date]),[['raw',70,ago(23)],['artist',40,ago(17)]]);
  assert.deepEqual(perf.companies.find(r=>r.company===company),{company,paid:12000,balance:18000,lastPaid:ago(8),averageDays:20,oldestUnpaidDays:28});
  assert.deepEqual([0,10,11,14,15,19,20].map(globalThis.__dashboard.stockAgeBand),[0,0,1,1,2,2,3]);
  const partial=globalThis.__dashboard.companyPaymentPerformance([
   {company:'x',date:ago(50),kind:'payment',amount:-500},
   {company:'x',date:ago(40),kind:'bill',amount:1000},
   {company:'x',date:ago(35),kind:'damage_adjustment',amount:-200},
   {company:'x',date:ago(5),kind:'payment',amount:-300},
  ],date)[0];
  assert.equal(partial.paid,800);assert.equal(partial.balance,0);assert.equal(partial.averageDays,13.125);assert.equal(partial.oldestUnpaidDays,null);
  const office=await get('metric=custody&view=office');assert.ok(!office.balances.some(b=>b.company===company));
  await get('mode=performance&view=office',403);await get('metric=__proto__',400);
  globalThis.__identity={signedIn:true,staff:{...owner,role:'Office Staff'}};await get('mode=performance',403);
  const staff=await get('metric=with_artists');assert.equal(staff.current,0);assert.deepEqual(staff.balances,[]);
  globalThis.__identity={signedIn:false};await get('metric=custody',403);
  console.log('PASS: dashboard SQL, four reconciled totals, exact issue movement, corrected and reversed entries, pooled age, payment timing and Office/auth scope. Fixture checks:',checks);throw Error('ROLLBACK_TEST');
 }
 if(process.env.IMS_TEST_ART_STYLES_ONLY==='1'){
  globalThis.__artisanIdentity=await load(await source('../lib/artisan-identity.ts'));
  const mastersSource=(await source('../app/api/production/masters/route.ts')).replace("import { db } from '@/lib/database';",'const db=globalThis.__db;').replace("import { inventorySession } from '@/lib/inventory-identity';",'const inventorySession=async()=>globalThis.__identity;').replace("import { artisanWorkTypes, isManagement, isOfficeRole, permitted, roleLabel } from '@/lib/rules';",'const {artisanWorkTypes,isManagement,isOfficeRole,permitted,roleLabel}=globalThis.__rules;').replace("import { artisanIdentity } from '@/lib/artisan-identity';",'const {artisanIdentity}=globalThis.__artisanIdentity;');
  const masters=await load(mastersSource),create=async(v,status=200,key=randomUUID())=>{const r=await masters.POST(new Request('https://im.tarafabbs.com/api/production/masters',{method:'POST',headers:{origin:'https://im.tarafabbs.com'},body:JSON.stringify({key,...v})}));const body=await r.json();assert.equal(r.status,status,JSON.stringify(body));checks++;return body;};
  const style='Test Art '+randomUUID(),key=randomUUID(),created=await create({kind:'art_style',name:'  '+style+'  '},200,key);assert.equal((await create({kind:'art_style',name:'  '+style+'  '},200,key)).id,created.id);
  await create({kind:'art_style',name:style.toUpperCase()},400);await create({kind:'art_style',name:' '},400);await create({kind:'art_style',name:'x'.repeat(121)},400);
  let snapshot=await (await GET(new Request('https://im.tarafabbs.com/api/production'))).json();assert.ok(snapshot.artStyles.some(s=>s.name===style));assert.ok(!snapshot.artisans.some(a=>a.work_types.includes(style)),'Style creation must not assign every artist');
  await send({kind:'receipt',company,lines:[{company,product,quantity:5,preferred:style}]});
  await send({kind:'issue',company,lines:[{source:account('raw'),quantity:2,artisan:artist,artwork:style}]});assert.equal(await q(account('artist','',style,artist)),2);
  const extra='Custom profile art '+randomUUID();const made=await create({kind:'artisan',name:'Test Artist '+randomUUID(),work_types:[style,extra]});
  assert.deepEqual((await tx`select work_types from inventory.artisans where id=${made.id}`)[0].work_types,[style,extra]);assert.ok((await tx`select id from inventory.art_styles where name=${extra}`).length);
  const audit=await tx`select actor_id,after_data from inventory.change_audit where action='production_art_style_created' and target_label=${style}`;assert.equal(audit.length,1);assert.equal(audit[0].actor_id,owner.id);
  for(const role of ['Viewer','Office Staff','Assistant Manager','Office Manager']){globalThis.__identity={signedIn:true,staff:{...owner,role}};await create({kind:'art_style',name:'Denied '+randomUUID()},403);}globalThis.__identity={signedIn:true,staff:owner};
  const office=await (await GET(new Request('https://im.tarafabbs.com/api/production?view=office'))).json();assert.deepEqual(office.artStyles,[]);
  const flags=await tx`select c.relrowsecurity as rls,has_table_privilege('anon',c.oid,'SELECT') as anon_read,has_table_privilege('authenticated',c.oid,'INSERT') as auth_write from pg_class c where c.oid='inventory.art_styles'::regclass`;assert.deepEqual({...flags[0]},{rls:true,anon_read:false,auth_write:false});
  console.log('PASS: shared art-style API/PostgreSQL:',checks,'checks; trimmed names, duplicate/length validation, retry idempotency, audit identity, snapshot before artist assignment, preferred receipt + actual artwork, custom profile style registration, Office/Viewer denial and private RLS. Fixtures rolled back.');throw Error('ROLLBACK_TEST');
 }
 if(process.env.IMS_TEST_PREFERENCES_ONLY==='1'){
  const recordsSource=(await source('../app/api/production/records/route.ts')).replace("import { db } from '@/lib/database';",'const db=globalThis.__db;').replace("import { inventorySession } from '@/lib/inventory-identity';",'const inventorySession=async()=>globalThis.__identity;').replace("import { isOfficeRole, permitted } from '@/lib/rules';",'const {isOfficeRole,permitted}=globalThis.__rules;');
  const records=await load(recordsSource),preferences=async(co=company,pr=product,status=200)=>{const response=await records.GET(new Request('https://im.tarafabbs.com/api/production/records?'+new URLSearchParams({mode:'preferences',company:co,product:pr})));const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));checks++;return body.artworks;};
  const first=await send({kind:'receipt',company,lines:[{company,product,quantity:10,preferred:'Free Hand Paint'},{company,product,quantity:10,preferred:'Block Print'}]});
  await send({kind:'receipt',company:own,lines:[{company:own,product,quantity:10,preferred:'Other Company Art'}]});
  assert.deepEqual(await preferences(),['Block Print','Free Hand Paint']);
  await send({kind:'correct',document:first.id,notes:'Correct preferred reference',lines:[{company,product,quantity:10,preferred:'Block Print'},{company,product,quantity:10,preferred:'Block Print'}]});assert.deepEqual(await preferences(),['Block Print']);
  await send({kind:'issue',company,lines:[{source:account('raw'),quantity:2,artisan:artist,artwork:'Free Hand Paint'}]});assert.equal(await q(account('artist','','Free Hand Paint',artist)),2);
  const second=await send({kind:'receipt',company,lines:[{company,product,quantity:3,preferred:'Free Hand Paint'}]});await send({kind:'delete',document:second.id,notes:'Remove test receipt'});assert.deepEqual(await preferences(),['Block Print']);
  assert.deepEqual(await preferences(company,randomUUID()),[]);await preferences('',product,400);
  const resetId=randomUUID();await tx`insert into inventory.production_events(id,kind,company,event_date,actor_id,actor,actor_role,payload,delta) values(${resetId},'reset',${company},${date},${owner.id},${owner.name},'Owner','{}'::jsonb,'[]'::jsonb)`;assert.deepEqual(await preferences(),[]);
  await tx`insert into inventory.production_events(id,kind,company,event_date,actor_id,actor,actor_role,payload,delta) values(${randomUUID()},'undo_reset',${company},${date},${owner.id},${owner.name},'Owner',${JSON.stringify({document:resetId})}::text::jsonb,'[]'::jsonb)`;assert.deepEqual(await preferences(),['Block Print']);
  globalThis.__artisanIdentity=await load(await source('../lib/artisan-identity.ts'));
  const mastersSource=(await source('../app/api/production/masters/route.ts')).replace("import { db } from '@/lib/database';",'const db=globalThis.__db;').replace("import { inventorySession } from '@/lib/inventory-identity';",'const inventorySession=async()=>globalThis.__identity;').replace("import { artisanWorkTypes, isManagement, isOfficeRole, permitted, roleLabel } from '@/lib/rules';",'const {artisanWorkTypes,isManagement,isOfficeRole,permitted,roleLabel}=globalThis.__rules;').replace("import { artisanIdentity } from '@/lib/artisan-identity';",'const {artisanIdentity}=globalThis.__artisanIdentity;');
  const masters=await load(mastersSource),createProfile=async(kind,view,status=200)=>{const response=await masters.POST(new Request('https://im.tarafabbs.com/api/production/masters',{method:'POST',headers:{origin:'https://im.tarafabbs.com'},body:JSON.stringify({kind,view,key:randomUUID(),name:'Test '+kind+' '+randomUUID(),ownership:'OWN'})}));const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));checks++;return body;};
  const officeCompany=await createProfile('company','office'),officeCategory=await createProfile('product','office'),workshopCompany=await createProfile('company','workshop');
  assert.deepEqual({...((await tx`select office_only,ownership from inventory.companies where id=${officeCompany.id}`)[0])},{office_only:1,ownership:'EXTERNAL'});assert.equal((await tx`select office_only from inventory.products where id=${officeCategory.id}`)[0].office_only,1);assert.equal((await tx`select office_only from inventory.companies where id=${workshopCompany.id}`)[0].office_only,0);
  globalThis.__identity={signedIn:true,staff:{...owner,role:'Supervisor'}};await createProfile('company','office',403);
  globalThis.__identity={signedIn:true,staff:{...owner,role:'Office Staff'}};await preferences(company,product,403);
  console.log('PASS: receipt preference API/PostgreSQL:',checks,'checks; pooled references, company/category isolation, corrected/reversed receipts, reset/restore, independent actual artwork and Office denial. Fixtures rolled back.');throw Error('ROLLBACK_TEST');
 }
 if(process.env.IMS_TEST_PROFILES_ONLY==='1'){
  const statusSource=(await source('../app/api/production/profile-status/route.ts')).replace("import {db} from '@/lib/database';",'const db=globalThis.__db;').replace("import {inventorySession} from '@/lib/inventory-identity';",'const inventorySession=async()=>globalThis.__identity;').replace("import {isOwner,roleLabel} from '@/lib/rules';",'const {isOwner,roleLabel}=globalThis.__rules;');
  const statusApi=await load(statusSource),change=async(kind,id,status,expected=200,key=randomUUID(),reason='Test profile status')=>{const r=await statusApi.POST(new Request('https://im.tarafabbs.com/api/production/profile-status',{method:'POST',headers:{origin:'https://im.tarafabbs.com'},body:JSON.stringify({kind,id,status,key,reason})}));const body=await r.json();assert.equal(r.status,expected,JSON.stringify(body));checks++;return body;};
  await send({kind:'receipt',company,lines:[{company,product,quantity:50}]});
  await send({kind:'issue',company,lines:[{source:account('raw'),quantity:20,artisan:artist,artwork:'Free Hand Paint'}]});
  await send({kind:'receive',company,amount:100,lines:[{source:account('artist','','Free Hand Paint',artist),quantity:5}]});
  await send({kind:'dispatch',company,amount:200,lines:[{source:account('ready','Free Hand Paint'),quantity:3}]});
  const state=async()=>JSON.stringify({stock:await tx`select * from inventory.production_balances where company=${company} order by key`,events:await tx`select * from inventory.production_events where company=${company} order by id`,companyMoney:await tx`select * from inventory.production_money where company=${company} order by id`,artisanMoney:await tx`select * from inventory.artisan_money where artisan=${artist} order by id`});
  const before=await state(),statusKey=randomUUID();await change('company',company,'paused',200,statusKey);await change('company',company,'paused',200,statusKey);await change('artisan',artist,'paused');assert.equal(await state(),before);
  assert.equal(Number((await tx`select count(*) as n from inventory.change_audit where after_data->>'id'=${company} and action='production_profile_status'`)[0].n),1);
  await change('company',company,'archived',409,statusKey);await change('product',product,'deleted',400);await change('company',company,'unknown',400);await change('company',company,'archived',400,randomUUID(),'');
  for(const role of ['Management','Office Manager','Supervisor','Office Staff','Viewer']){globalThis.__identity={signedIn:true,staff:{...owner,role}};await change('company',company,'active',403);}globalThis.__identity={signedIn:true,staff:owner};
  await send({kind:'receipt',company,lines:[{company,product,quantity:1}]},400);
  await send({kind:'issue',company,lines:[{source:account('raw'),quantity:1,artisan:artist,artwork:'Free Hand Paint'}]},400);
  await send({kind:'receipt',company,correctionKind:'payment',lines:[{company,product,quantity:1}]},400);
  await send({kind:'issue',company,correctionKind:'receive',lines:[{source:account('raw'),quantity:1,artisan:artist,artwork:'Free Hand Paint'}]},400);
  await send({kind:'receive',company,amount:20,lines:[{source:account('artist','','Free Hand Paint',artist),quantity:2,disputeQuantity:1}]});
  assert.equal(await q(account('reprint','','Free Hand Paint',artist)),1);
  await change('company',company,'archived');await change('artisan',artist,'deleted');
  const archivedBefore=await state();await change('company',company,'deleted');assert.equal(await state(),archivedBefore);
  globalThis.__artisanMoney=await load((await source('../lib/artisan-money.ts')).replace(/import \{ paise \} from '\.\/production';/,'const {paise}=globalThis.__prod;'));
  const moneySource=(await source('../app/api/production/artisan-money/route.ts')).replace("import {db} from '@/lib/database';",'const db=globalThis.__db;').replace("import {inventorySession} from '@/lib/inventory-identity';",'const inventorySession=async()=>globalThis.__identity;').replace("import {isManagement,isOfficeRole,isOwner,roleLabel} from '@/lib/rules';",'const {isManagement,isOfficeRole,isOwner,roleLabel}=globalThis.__rules;').replace(/import \{[^;]+\} from '@\/lib\/artisan-money';/,'const {artisanMoneyAmount}=globalThis.__artisanMoney;');
  const paid=await (await load(moneySource)).POST(new Request('https://im.tarafabbs.com/api/production/artisan-money',{method:'POST',headers:{origin:'https://im.tarafabbs.com'},body:JSON.stringify({key:randomUUID(),artisan:artist,kind:'payment',date,amount:25})}));assert.equal(paid.status,200,JSON.stringify(await paid.json()));checks++;
  assert.equal(Number((await tx`select sum(amount) as due from inventory.artisan_money where artisan=${artist}`)[0].due),9500);
  await send({kind:'receive',company,lines:[{source:account('reprint','','Free Hand Paint',artist),quantity:1}]});
  await send({kind:'dispatch',company,amount:10,lines:[{source:account('ready','Free Hand Paint'),quantity:1}]});await send({kind:'payment',company,amount:50});
  const snap=await (await GET(new Request('https://im.tarafabbs.com/api/production'))).json();assert.equal(snap.companies.find(c=>c.id===company).profile_status,'deleted');assert.equal(snap.artisans.find(a=>a.id===artist).profile_status,'deleted');
  await change('company',company,'active');await change('artisan',artist,'active');
  await send({kind:'receipt',company,lines:[{company,product,quantity:1}]});
  await send({kind:'issue',company,lines:[{source:account('raw'),quantity:1,artisan:artist,artwork:'Free Hand Paint'}]});
  const [audit]=await tx`select actor_id,after_data from inventory.change_audit where after_data->>'id'=${artist} and after_data->>'profile_status'='deleted'`;assert.equal(audit.actor_id,owner.id);assert.equal(audit.after_data.reason,'Test profile status');
  console.log('PASS: Owner profile lifecycle API/PostgreSQL:',checks,'checks; pause/archive/delete/restore, denied non-owners, audit + retry idempotency, history/stock/finance unchanged by status, blocked new intake/work, inactive receipt/repaint/dispatch/payment settlement and preserved profile IDs. Fixtures rolled back.');throw Error('ROLLBACK_TEST');
 }
 if(process.env.IMS_TEST_ENTRY_ONLY==='1'){
  const vendor=randomUUID(),officeProduct=randomUUID();
  await tx`insert into inventory.companies(id,name,prefix,ownership,office_only) values(${vendor},'Test Office Vendor','TEV','EXTERNAL',1)`;
  await tx`insert into inventory.products(id,name,office_only) values(${officeProduct},'Test Office Category',1)`;
  const receipt={kind:'receipt',company,lines:[{company,product,quantity:10,preferred:'Free Hand Paint'},{company,product,quantity:10,preferred:'Block Print'}]},key=randomUUID();
  const first=await send(receipt,200,key);await send(receipt,200,key);assert.equal(await q(account('raw')),20);
  await send(receipt);assert.equal(await q(account('raw')),40);
  const [saved]=await tx`select payload from inventory.production_events where id=${first.id}`;
  assert.deepEqual(saved.payload.lines.map(l=>l.preferred),['Free Hand Paint','Block Print']);
  const wrong=await send({...receipt,company:vendor,lines:receipt.lines.map(l=>({...l,company:vendor}))},400);
  assert.match(wrong.error,/Office-only vendor/);assert.equal(await q(account('raw')),40);
  await send({kind:'receipt',company,lines:[{company,product:officeProduct,quantity:5}]},400);
  await send({kind:'office_vendor',company:vendor,lines:[{company:vendor,product:officeProduct,quantity:5}]});
  assert.equal(Number((await tx`select quantity from inventory.production_balances where company=${vendor} and product=${officeProduct} and stage='office_stock'`)[0].quantity),5);
  console.log('PASS: New Entry API/PostgreSQL:',checks,'checks; same category/quantity across artwork lines and repeated deliveries, retained preferred art, retry idempotency, Workshop/Office boundary, Office vendor receipt. Fixtures rolled back.');throw Error('ROLLBACK_TEST');
 }
 if(process.env.IMS_TEST_STATEMENTS_ONLY==='1'){
  const yesterday=new Date(Date.now()-864e5).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
  globalThis.__artisanMoney=await load((await source('../lib/artisan-money.ts')).replace(/import \{ paise \} from '\.\/production';/,'const {paise}=globalThis.__prod;'));
  let moneySource=await source('../app/api/production/artisan-money/route.ts');moneySource=moneySource.replace(/import \{db\} from '@\/lib\/database';/,'const db=globalThis.__db;').replace(/import \{inventorySession\} from '@\/lib\/inventory-identity';/,'const inventorySession=async()=>globalThis.__identity;').replace(/import \{[^;]+\} from '@\/lib\/rules';/,'const {isManagement,isOfficeRole,isOwner,roleLabel}=globalThis.__rules;').replace(/import \{[^;]+\} from '@\/lib\/artisan-money';/,'const {artisanMoneyAmount}=globalThis.__artisanMoney;');
  const moneyApi=await load(moneySource),moneyPost=async(c,status=200,key=randomUUID())=>{const response=await moneyApi.POST(new Request('https://im.tarafabbs.com/api/production/artisan-money',{method:'POST',headers:{origin:'https://im.tarafabbs.com','Content-Type':'application/json'},body:JSON.stringify({artisan:artist,date,...c,key})}));const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));checks++;return body;};
  globalThis.__statementCore=await load(await source('../lib/statements.ts'));
  globalThis.__statementSource=await load((await source('../lib/statement-source.ts')).replace("import {db} from './database';",'const db=globalThis.__db;'));
  let statementApiSource=await source('../app/api/production/statements/route.ts');statementApiSource=statementApiSource.replace(/import \{inventorySession\} from '@\/lib\/inventory-identity';/,'const inventorySession=async()=>globalThis.__identity;').replace(/import \{isOfficeRole,permitted\} from '@\/lib\/rules';/,'const {isOfficeRole,permitted}=globalThis.__rules;').replace(/import \{statementSource\} from '@\/lib\/statement-source';/,'const {statementSource}=globalThis.__statementSource;').replace(/import \{buildStatement,statementFilter\} from '@\/lib\/statements';/,'const {buildStatement,statementFilter}=globalThis.__statementCore;');
  const statements=await load(statementApiSource),statement=async(scope,id,from='',to=date,status=200)=>{const response=await statements.GET(new Request('https://im.tarafabbs.com/api/production/statements?'+new URLSearchParams({scope,id,from,to})));const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));checks++;return body;};
  await send({kind:'receipt',company,date:yesterday,lines:[{company,product,quantity:100}]});
  await send({kind:'issue',company,date:yesterday,lines:[{source:account('raw'),quantity:50,artisan:artist,artwork:'Free Hand Paint'}]});
  const advance={kind:'payment',amount:1000,date:yesterday,reference:'Advance'},paymentKey=randomUUID();await moneyPost(advance,200,paymentKey);await moneyPost(advance,200,paymentKey);
  const receipt={kind:'receive',company,amount:600,reference:'Artist bill',effectiveArtisanMoney:[{artisan:artist,amount:999999,kind:'charge'}],lines:[{source:account('artist','','Free Hand Paint',artist),quantity:20,disputeQuantity:3}]},receiptKey=randomUUID();const received=await send(receipt,200,receiptKey);await send(receipt,200,receiptKey);
  let report=await statement('artisan',artist,date);assert.equal(report.artisanPeriod[0].opening,-100000);assert.equal(report.artisanPeriod[0].closing,-40000);assert.equal(report.metrics.artisanAdvance,40000);assert.equal(report.metrics.custody,33);assert.equal(report.artisanLedger.length,1);
  const past=await statement('artisan',artist,'',yesterday);assert.equal(past.metrics.custody,50);assert.equal(past.metrics.artisanAdvance,100000);
  await moneyPost({kind:'refund',amount:401},400);await moneyPost({kind:'refund',amount:400});
  const correction=await send({kind:'correct',document:received.id,notes:'Correct artist bill',amount:800});
  await send({kind:'correct',document:correction.id,notes:'Correct bill again',amount:700});
  report=await statement('artisan',artist);assert.equal(report.metrics.artisanDue,10000);assert.equal(report.metrics.artisanAdvance,0);assert.equal(report.artisanLedger.reduce((s,e)=>s+e.amount,0),10000);assert.ok(report.artisanLedger.some(e=>e.kind==='correct'));
  let summarySource=await source('../app/api/production/records/route.ts');summarySource=summarySource.replace(/import \{ db \} from '@\/lib\/database';/,'const db=globalThis.__db;').replace(/import \{ inventorySession \} from '@\/lib\/inventory-identity';/,'const inventorySession=async()=>globalThis.__identity;').replace(/import \{ isOfficeRole, permitted \} from '@\/lib\/rules';/,'const {isOfficeRole,permitted}=globalThis.__rules;');
  const summaryApi=await load(summarySource);const summaryResponse=await summaryApi.GET(new Request('https://im.tarafabbs.com/api/production/records?mode=artist&artisan='+artist));const summary=await summaryResponse.json();assert.equal(summaryResponse.status,200,JSON.stringify(summary));assert.equal(summary.given,53);assert.equal(summary.received,20);checks++;
  await send({kind:'dispatch',company,amount:5000,lines:[{source:account('ready','Free Hand Paint'),quantity:10}]});await send({kind:'payment',company,amount:2000});
  report=await statement('company',company,date);assert.equal(report.metrics.companyDue,300000);assert.equal(report.metrics.custody,90);assert.equal(report.metrics.ready,7);assert.equal(report.companyLedger.at(-1).after,300000);assert.equal(report.companyLedger.at(-1).before,500000);
  const oldCompany=await statement('company',company,'',yesterday);assert.equal(oldCompany.metrics.custody,100);assert.equal(oldCompany.metrics.ready,0);assert.equal(oldCompany.metrics.companyDue,0);
  const all=await statement('overall','',date);assert.equal(all.artisanRows.find(a=>a.id===artist).due,10000);assert.equal(all.companyRows.find(c=>c.id===company).due,300000);
  const damageDoc=await send({kind:'damage',company,notes:'Statement damage fixture',lines:[{source:account('raw'),quantity:2}]});
  await send({kind:'settle',company,document:damageDoc.id,notes:'Cash compensation',reason:'1',settlement:'cash',amount:50});
  const damagedReport=await statement('company',company);assert.equal(damagedReport.metrics.damaged,2);assert.equal(damagedReport.metrics.unsettledDamage,1);
  await tx`insert into inventory.production_events(kind,company,event_date,notes,actor_id,actor,actor_role,payload,delta) values('reset',${company},${date},'Fixture reset marker',${owner.id},${owner.name},'Owner',${JSON.stringify({kind:'reset',date,resetDocuments:[damageDoc.id]})}::text::jsonb,'[]')`;
  const archivedLoss=await statement('company',company);assert.equal(archivedLoss.metrics.damaged,2);assert.equal(archivedLoss.metrics.unsettledDamage,0);assert.equal(archivedLoss.documents.find(d=>d.id===damageDoc.id).voided,true);
  globalThis.__identity={signedIn:true,staff:{...owner,role:'Viewer'}};await moneyPost({kind:'payment',amount:1},403);
  globalThis.__identity={signedIn:true,staff:{...owner,role:'Office Staff'}};await statement('overall','','',date,403);
  console.log('PASS: statement/finance API + PostgreSQL:',checks,'checks; dated stock, opening/closing balances, advances, cash refunds, receipt charges, repeat corrections, retry idempotency and Office restrictions. Fixtures rolled back.');throw Error('ROLLBACK_TEST');
 }
 if(process.env.IMS_TEST_RECEIVE_ONLY==='1'){
  await send({kind:'receipt',company,lines:[{company,product,quantity:100}]});
  await send({kind:'issue',company,lines:[{source:account('raw'),quantity:50,artisan:artist,artwork:'Free Hand Paint'}]});
  const command={kind:'receive',company,lines:[{source:account('artist','','Free Hand Paint',artist),quantity:20,disputeQuantity:3}]},key=randomUUID();
  const received=await send(command,200,key);await send(command,200,key);
  assert.equal(await q(account('raw')),50);assert.equal(await q(account('artist','','Free Hand Paint',artist)),30);
  assert.equal(await q(account('ready','Free Hand Paint')),17);assert.equal(await q(account('reprint','','Free Hand Paint',artist)),3);
  const corrected=await send({kind:'correct',document:received.id,notes:'Correct received count',lines:[{...command.lines[0],quantity:18}]});
  assert.equal(await q(account('artist','','Free Hand Paint',artist)),32);assert.equal(await q(account('ready','Free Hand Paint')),15);
  await send({kind:'receive',company,lines:[{source:account('reprint','','Free Hand Paint',artist),quantity:3,disputeQuantity:1}]});
  assert.equal(await q(account('reprint','','Free Hand Paint',artist)),1);assert.equal(await q(account('ready','Free Hand Paint')),17);
  await send({kind:'receive',company,lines:[{...command.lines[0],quantity:5,disputeQuantity:6}]},400);
  await send({kind:'receive',company,lines:[{...command.lines[0],quantity:40,disputeQuantity:0}]},400);
  assert.equal(await q(account('artist','','Free Hand Paint',artist)),32);
  const snap=await GET(new Request('https://im.tarafabbs.com/api/production'));const body=await snap.json();
  assert.equal(body.balances.filter(b=>b.company===company).reduce((s,b)=>s+b.quantity,0),100);
  globalThis.__identity={signedIn:true,staff:{...owner,role:'Viewer'}};await send(command,403);
  console.log('PASS: API/PostgreSQL receipt split, atomic correction, repaint, idempotent retry, bounds, unchanged raw, conservation and permissions. All fixtures rolled back.');throw Error('ROLLBACK_TEST');
 }
 if(process.env.IMS_TEST_OFFICE_ONLY==='1'){
  const vendor=randomUUID(),officeProduct=randomUUID();await tx`insert into inventory.companies(id,name,prefix,ownership,office_only) values(${vendor},'Test Vendor','TV','EXTERNAL',1)`;await tx`insert into inventory.products(id,name,office_only) values(${officeProduct},'Test Office Product',1)`;
  await tx`update inventory.users set role='Office Manager' where id=${owner.id}`;globalThis.__identity={signedIn:true,staff:{...owner,role:'Office Manager'}};
  const received=await send({kind:'office_vendor',company:vendor,reference:'Original',lines:[{company:vendor,product:officeProduct,quantity:10}]});
  await send({kind:'correct',company:vendor,document:received.id,reference:'Corrected',notes:'Correct receipt reference'});
  assert.equal(Number((await tx`select sum(quantity)::float8 as n from inventory.production_balances where company=${vendor}`)[0].n),10);
  const snap=await GET(new Request('https://im.tarafabbs.com/api/production'));assert.ok((await snap.json()).history.some(e=>e.kind==='correct'));
  globalThis.__identity={signedIn:true,staff:{...owner,role:'Office Staff'}};await send({kind:'correct',document:received.id,notes:'Not permitted'},403);
  console.log('Office receipt detail correction and Office Staff restriction passed.');throw Error('ROLLBACK_TEST');
 }
 if(process.env.IMS_TEST_ORDER_ONLY==='1'){
  await send({kind:'receipt',company,lines:[{company,product,quantity:5}]});
  const damaged=await send({kind:'damage',company,notes:'Outside replacement test',lines:[{source:account('raw'),quantity:2}]});
  const order=await send({kind:'order',company,product,document:damaged.id,reason:'2',amount:100,notes:'Vendor replacement'});
  await send({kind:'order_receive',company,document:order.id,lines:[{company,product,quantity:2,outcome:'raw'}]});
  assert.equal((await tx`select settled from inventory.production_documents where id=${damaged.id}`)[0].settled,2);assert.equal(await q(account('raw')),5);
  console.log('Outside replacement API + PostgreSQL: 4 postings and damage settlement passed.');throw Error('ROLLBACK_TEST');
 }
 const receipt={kind:'opening',confirm:true,company,lines:[{source:account('raw'),quantity:100}],openingDue:5000};const key=randomUUID();await send(receipt,200,key);await send(receipt,200,key);assert.equal(await q(account('raw')),100);
 await send({...receipt,openingDue:6000},409,key);
 const issued=await send({kind:'issue',company,lines:[{source:account('raw'),quantity:50,artisan:artist,artwork:'Free Hand Paint'}]});
 await send({kind:'receive',company,lines:[{source:account('artist','','Free Hand Paint',artist),quantity:20}]});
 const corrected=await send({kind:'correct',company,document:issued.id,notes:'Correct 50 to 40',lines:[{source:account('raw'),quantity:40,artisan:artist,artwork:'Free Hand Paint'}]});assert.equal(await q(account('artist','','Free Hand Paint',artist)),20);assert.equal(await q(account('raw')),60);
 await send({kind:'correct',company,document:corrected.id,notes:'Correct 40 to 35',lines:[{source:account('raw'),quantity:35,artisan:artist,artwork:'Free Hand Paint'}]});assert.equal(await q(account('artist','','Free Hand Paint',artist)),15);
 await send({kind:'dispatch',company,amount:1000,lines:[{source:account('ready','Free Hand Paint'),quantity:10}]});
 await send({kind:'company_return',company,lines:[{source:account('delivered','Free Hand Paint'),quantity:4}]});
 await send({kind:'return_send',company,lines:[{source:account('hold','Free Hand Paint','','','company_return'),quantity:4,artisan:artist,artwork:'Block Print'}]});
 await send({kind:'return_receive',company,lines:[{source:account('artist','Free Hand Paint','Block Print',artist,'company_return'),quantity:4}]});
 await send({kind:'dispatch',company,amount:0,lines:[{source:account('ready','Block Print + Free Hand Paint','','','company_return'),quantity:4}]});
 await send({kind:'payment',company,amount:2000});
 const [money]=await tx`select sum(amount)::float8 as due from inventory.production_money where company=${company}`;assert.equal(money.due,400000);
 await send({kind:'receipt',company:own,lines:[{company:own,product,quantity:10}]});
 const damage=await send({kind:'damage',company,notes:'Test damage',lines:[{source:account('raw'),quantity:5}]});
 await send({kind:'replacement',company,targetCompany:company,document:damage.id,notes:'Replace three',lines:[{source:account('raw','','','','normal',own),quantity:3}]});
 await send({kind:'settle',company,document:damage.id,notes:'Settle two',reason:'2',settlement:'due',amount:100});
 assert.equal((await tx`select settled from inventory.production_documents where id=${damage.id}`)[0].settled,5);
 await send({kind:'settle',company,document:damage.id,notes:'Duplicate',reason:'1',settlement:'cash',amount:10},400);
 await send({kind:'issue',company,lines:[{source:account('raw'),quantity:999,artisan:artist,artwork:'Free Hand Paint'}]},400);
 const result=await GET(new Request('https://im.tarafabbs.com/api/production'));assert.equal(result.status,200);assert.ok((await result.json()).balances.length);checks++;
 globalThis.__identity={signedIn:true,staff:{...owner,role:'Viewer'}};await send({kind:'receipt',company,lines:[{company,product,quantity:1}]},403);

 let recordsSource=await source('../app/api/production/records/route.ts');recordsSource=recordsSource.replace(/import \{\s*db\s*\} from '@\/lib\/database';/, 'const db=globalThis.__db;').replace(/import \{\s*inventorySession\s*\} from '@\/lib\/inventory-identity';/,'const inventorySession=async()=>globalThis.__identity;').replace(/import \{[^;]+\} from '@\/lib\/rules';/,'const {isOfficeRole,permitted}=globalThis.__rules;');
 const records=await load(recordsSource);globalThis.__identity={signedIn:true,staff:owner};const reports=await records.GET(new Request('https://im.tarafabbs.com/api/production/records?mode=reports&company='+company));const report=await reports.json();assert.equal(reports.status,200,JSON.stringify(report));assert.ok(report.actions.length);checks++;
 const history=await records.GET(new Request('https://im.tarafabbs.com/api/production/records?company='+company+'&kind=dispatch&date='+date));const h=await history.json();assert.equal(history.status,200,JSON.stringify(h));assert.equal(h.history.length,2);checks++;
 globalThis.__artisanIdentity=await load(await source('../lib/artisan-identity.ts'));
 let mastersSource=await source('../app/api/production/masters/route.ts');mastersSource=mastersSource.replace(/import \{\s*db\s*\} from '@\/lib\/database';/, 'const db=globalThis.__db;').replace(/import \{\s*inventorySession\s*\} from '@\/lib\/inventory-identity';/,'const inventorySession=async()=>globalThis.__identity;').replace(/import \{[^;]+\} from '@\/lib\/rules';/,'const {artisanWorkTypes,isManagement,isOfficeRole,permitted,roleLabel}=globalThis.__rules;').replace(/import \{[^;]+\} from '@\/lib\/artisan-identity';/,'const {artisanIdentity}=globalThis.__artisanIdentity;');
 const masters=await load(mastersSource);const create=await masters.POST(new Request('https://im.tarafabbs.com/api/production/masters',{method:'POST',body:JSON.stringify({key:randomUUID(),kind:'artisan',name:'Test Multi Specialist '+randomUUID(),work_types:['Free Hand Paint','Custom R'],contact:'',address:''})}));const m=await create.json();assert.equal(create.status,200,JSON.stringify(m));assert.equal((await tx`select work_types from inventory.artisans where id=${m.id}`)[0].work_types.length,2);checks++;
 const reset=await send({kind:'reset',confirm:true,notes:'Test Owner reset'});assert.equal(Number((await tx`select coalesce(sum(quantity),0)::float8 as n from inventory.production_balances`)[0].n),0);await send({kind:'undo_reset',document:reset.id,notes:'Restore test'});assert.ok(await q(account('raw'))>0);
 globalThis.__identity={signedIn:true,staff:{...owner,role:'Management'}};await send({kind:'reset',confirm:true,notes:'Not Owner'},403);
 console.log('Production API + PostgreSQL checks passed:',checks);throw Error('ROLLBACK_TEST');
 });}catch(e){if(e.message!=='ROLLBACK_TEST')throw e;}finally{await sql.end();}
