// Real PostgreSQL posting tests. Every fixture and schema change is rolled back.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import ts from 'typescript';import postgres from 'postgres';import {randomUUID} from 'node:crypto';
const source=async p=>readFile(new URL(p,import.meta.url),'utf8');const load=async text=>import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const prod=await load(await source('../lib/production.ts'));const rules=await load(await source('../lib/rules.ts'));
globalThis.__prod=prod;globalThis.__rules=rules;
const sql=postgres(process.env.SUPABASE_DATABASE_URL||process.env.POSTGRES_URL||process.env.DATABASE_URL,{ssl:'require',max:1,prepare:false});let checks=0;
try{await sql.begin(async tx=>{
 if(!(await tx`select to_regclass('inventory.production_events') as t`)[0].t)await tx.unsafe(await source('../supabase/migrations/20261124204531_production_accounts.sql'));
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
