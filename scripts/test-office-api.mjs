// Office API integration test. Fixtures and the migration run in one rolled-back transaction.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import postgres from 'postgres';
const source=async p=>readFile(new URL(p,import.meta.url),'utf8');
const load=async code=>import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const sql=postgres(process.env.SUPABASE_DATABASE_URL,{max:1,prepare:false,ssl:'require'});let checks=0;
try{await sql.begin(async tx=>{
 const [migration]=await tx`select to_regclass('inventory.office_employee_codes') is not null as applied`;
 if(!migration.applied)await tx.unsafe(await source('../supabase/migrations/20261128011000_office_outlet.sql'));
 const prod=await load(await source('../lib/production.ts')),rules=await load(await source('../lib/rules.ts'));
 globalThis.__prod=prod;globalThis.__rules=rules;
 globalThis.__core=await load((await source('../lib/office-core.ts')).replace("import { accountKey, type Account, type Delta } from './production';",'const {accountKey}=globalThis.__prod;'));
 globalThis.__incentives=await load((await source('../lib/office-incentives.ts')).replace("import {defaultIncentiveRule,type IncentiveRule,type OfficeDocument} from './office-core';",'const {defaultIncentiveRule}=globalThis.__core;'));
 const wrapper=client=>({prepare(query){let n=0;query=query.replace(/\b(FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+(companies|products|artisans|settings|users)\b/gi,'$1 inventory.$2').replace(/\?/g,()=>'$'+(++n));const stmt=args=>({bind:(...args)=>stmt(args),first:async()=>((await client.unsafe(query,args))[0]||null),all:async()=>({results:await client.unsafe(query,args)}),run:async()=>client.unsafe(query,args)});return stmt([]);},transaction:fn=>client.savepoint(inner=>fn(wrapper(inner)))});
 globalThis.__db=wrapper(tx);
 let route=await source('../app/api/office/route.ts');
 route=route.replace("import {db} from '@/lib/database';",'const db=globalThis.__db;')
  .replace("import {inventorySession,officeUser,type InventoryUser} from '@/lib/inventory-identity';",'const inventorySession=async()=>globalThis.__identity;const officeUser=async staff=>{if(["Admin","Management"].includes(staff.role))return staff;const profile=await globalThis.__db.prepare("SELECT role FROM inventory.office_employees WHERE user_id=? AND active=true").bind(staff.id).first();return profile?{...staff,role:profile.role}:staff;};')
  .replace("import {accountKey,type Account,type Delta} from '@/lib/production';",'const {accountKey}=globalThis.__prod;')
  .replace("import {isOwner,roleLabel} from '@/lib/rules';",'const {isOwner,roleLabel}=globalThis.__rules;')
  .replace(/import \{defaultIncentiveRule,[^;]+\} from '@\/lib\/office-core';/,'const {defaultIncentiveRule,netOfficeDeltas,officeDay,officeFYear,officeNumber,officePaise,officeQuantity,officeReturnLoss,officeRoles,officeTax,returnReasons,sellingRoles,trimOffice,validOfficeDate}=globalThis.__core;')
  .replace("import {officeRewards} from '@/lib/office-incentives';",'const {officeRewards}=globalThis.__incentives;');
 const {GET,POST}=await load(route);
 const [owner]=await tx`select id,name,role from inventory.users where role='Admin' and active=1 limit 1`;assert.ok(owner);
 globalThis.__identity={signedIn:true,staff:owner};
 const company=randomUUID(),category=randomUUID(),date=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
 await tx`insert into inventory.companies(id,name,prefix,ownership) values(${company},'Office test own','OTO','OWN')`;
 await tx`insert into inventory.products(id,name) values(${category},'Office test silk')`;
 const account={company,product:category,pool:'normal',stage:'office_stock',artisan:'',arts:'',work:''};
 await tx`insert into inventory.production_balances(key,company,product,pool,stage,artisan,arts,work,quantity) values(${prod.accountKey(account)},${company},${category},'normal','office_stock','','','',10)`;
 const send=async(payload,status=200,key=randomUUID())=>{const r=await POST(new Request('https://im.tarafabbs.com/api/office',{method:'POST',headers:{origin:'https://im.tarafabbs.com'},body:JSON.stringify({key,...payload})}));const body=await r.json();assert.equal(r.status,status,JSON.stringify(body));checks++;return body;};
 const get=async(query='')=>{const r=await GET(new Request('https://im.tarafabbs.com/api/office'+query));const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));checks++;return body;};
 const count=async()=>Number((await tx`select quantity from inventory.production_balances where key=${prod.accountKey(account)}`)[0].quantity);
 const lead=(await send({op:'lead',name:'Customer A',phone:'9876543210',sameWhatsapp:true,address:'Kolkata',gst:'19AAAAA0000A1Z5'})).id;
 const product=(await send({op:'product',name:'Office Silk',stockProduct:category,price:100,hsn:'5007',sku:'S1',profit:5})).id;
 await send({op:'layout',seller:'TaraFabbs',address:'Kolkata',gst:'19AAAAA0000A1Z5',bankName:'Indian Bank',accountNumber:'1234567890',ifsc:'IDIB000A001',branch:'TEST'});
 const normal=await send({op:'bill',customer:lead,date,lines:[{product,source:prod.accountKey(account),quantity:2,unit:100}],paid:100,method:'Cash'});
 assert.match(normal.number,/^O-\d\d-0001$/);assert.equal(await count(),8);
 const hub=await get(),doc=hub.documents.find(d=>d.id===normal.id);assert.equal(doc.total,20000);assert.equal(hub.balances.find(b=>b.customer===lead).due,10000);
 await send({op:'payment',id:normal.id,revision:doc.revision,amount:100});assert.equal((await get()).balances.find(b=>b.customer===lead).due,0);
 const returned=await send({op:'return',bill:normal.id,line:0,quantity:1,unit:100,reason:'CASH RETURN',resolution:'cash',date});assert.equal(await count(),9);
 const returnDoc=(await get()).documents.find(d=>d.id===returned.id);assert.equal(returnDoc.body.loss,2000);assert.equal(returnDoc.total,-8000);
 await send({op:'return',id:returned.id,revision:returnDoc.revision,bill:normal.id,line:0,quantity:1,unit:50,reason:'Quality issue',resolution:'cash',date});
 const editedReturn=(await get()).documents.find(d=>d.id===returned.id);assert.equal(editedReturn.total,-5000);assert.equal(await count(),9);
 await send({op:'return',bill:normal.id,line:0,quantity:2,unit:100,reason:'FULL DISPUTE',resolution:'cash',date},400);
 const gst=await send({op:'bill',customer:lead,date,gst:true,cgst:9,sgst:9,lines:[{product,source:prod.accountKey(account),quantity:1,unit:100,hsn:'5007'}],paid:0});assert.match(gst.number,/^OG-\d\d-0001$/);assert.equal(await count(),8);
 const booking=await send({op:'bill',customer:lead,date,advance:true,deadline:date,lines:[{product,source:prod.accountKey(account),quantity:2,unit:100}],paid:50});assert.equal(await count(),8);
 const order=(await get()).documents.find(d=>d.id===booking.id);await send({op:'dispatch',id:booking.id,revision:order.revision,line:0,quantity:1,paymentReceived:true});assert.equal(await count(),7);
 const order2=(await get()).documents.find(d=>d.id===booking.id);await send({op:'dispatch',id:booking.id,revision:order2.revision,line:0,quantity:1,paymentReceived:true});assert.equal(await count(),6);
 const bill=(await get()).documents.find(d=>d.id===gst.id);await send({op:'void',id:gst.id,revision:bill.revision,confirm:true});assert.equal(await count(),7);
 const roleUser={id:randomUUID(),name:'Creative tester',role:'Office Staff',email:'creative-'+randomUUID()+'@example.test'};
 await tx`insert into inventory.users(id,name,email,role,active,created_at) values(${roleUser.id},${roleUser.name},${roleUser.email},${roleUser.role},1,${new Date().toISOString()})`;
 const manager=(await send({op:'employee',role:'Office Manager',name:'Office test manager',email:'manager-'+randomUUID()+'@example.test',joiningDate:date,salary:2000})).id;
 const staff=(await send({op:'employee',role:'Office Staff',name:roleUser.name,email:roleUser.email,joiningDate:date,salary:1000,managerId:manager,conversionTarget:20,retentionTarget:20})).id;
 const workshopUser={id:randomUUID(),name:'Workshop and Office tester',role:'Supervisor',email:'both-'+randomUUID()+'@example.test'};
 await tx`insert into inventory.users(id,name,email,role,active,created_at) values(${workshopUser.id},${workshopUser.name},${workshopUser.email},${workshopUser.role},1,${new Date().toISOString()})`;
 const dualProfile=(await send({op:'employee',role:'Office Staff',name:workshopUser.name,email:workshopUser.email,joiningDate:date,managerId:manager})).id;
 const [dualRow]=await tx`select u.role as workshop_role,e.role as office_role from inventory.users u join inventory.office_employees e on e.user_id=u.id where e.id=${dualProfile}`;
 assert.deepEqual([dualRow.workshop_role,dualRow.office_role],['Supervisor','Office Staff']);
 globalThis.__identity={signedIn:true,staff:workshopUser};
 assert.equal((await get()).user.role,'Office Staff');
 globalThis.__identity={signedIn:true,staff:owner};
 const staffRow=(await tx`select employee_code,manager_id,conversion_target,retention_target from inventory.office_employees where id=${staff}`)[0];assert.match(staffRow.employee_code,/^TF-\d{5}$/);assert.equal(staffRow.manager_id,manager);assert.deepEqual([staffRow.conversion_target,staffRow.retention_target],[0,0]);
 const assistant=(await send({op:'employee',role:'Assistant Manager',name:'Office test assistant',email:'assistant-'+randomUUID()+'@example.test',joiningDate:date,managerId:manager})).id;
 const otherManager=(await send({op:'employee',role:'Office Manager',name:'Other office manager',email:'other-manager-'+randomUUID()+'@example.test',joiningDate:date})).id;
 const managerUser=(await tx`select user_id from inventory.office_employees where id=${manager}`)[0].user_id;
 globalThis.__identity={signedIn:true,staff:{id:managerUser,name:'Office test manager',role:'Office Manager'}};
 const newAssistant=(await send({op:'employee',role:'Assistant Manager',name:'Manager-created assistant',email:'new-assistant-'+randomUUID()+'@example.test',joiningDate:date})).id;
 assert.equal((await tx`select manager_id from inventory.office_employees where id=${newAssistant}`)[0].manager_id,manager);
 await send({op:'employee',id:staff,role:'Office Staff',name:roleUser.name,email:roleUser.email,joiningDate:date,salary:1000,managerId:otherManager},403);
 await send({op:'employee',id:staff,role:'Office Staff',name:roleUser.name,email:roleUser.email,joiningDate:date,salary:1000,managerId:assistant});
 await send({op:'employee_target',id:staff,conversionTarget:25,retentionTarget:35});
 const moved=(await tx`select manager_id,conversion_target,retention_target from inventory.office_employees where id=${staff}`)[0];assert.deepEqual([moved.manager_id,moved.conversion_target,moved.retention_target],[assistant,25,35]);
 await send({op:'employee',id:staff,role:'Office Staff',name:roleUser.name,email:roleUser.email,joiningDate:date,salary:1000,managerId:manager});
 const preserved=(await tx`select conversion_target,retention_target from inventory.office_employees where id=${staff}`)[0];assert.deepEqual([preserved.conversion_target,preserved.retention_target],[25,35]);
 globalThis.__identity={signedIn:true,staff:owner};
 await send({op:'advance',employee:staff,date,amount:100,notes:'test'});
 await send({op:'salary',employee:staff,start:date,end:date,salary:1000,amount:400,adjust:100});
 const salary=(await tx`select salary,paid,advance_adjusted from inventory.office_salary_cycles where employee=${staff}`)[0];assert.deepEqual([Number(salary.salary),Number(salary.paid),Number(salary.advance_adjusted)],[100000,40000,10000]);
 await send({op:'openingDue',customer:lead,date,amount:20,notes:'Prior balance'});
 const openingHub=await get();assert.equal(openingHub.moneyRows.find(r=>r.customer===lead&&r.kind==='opening').amount,2000);
 globalThis.__identity={signedIn:true,staff:roleUser};await send({op:'product',name:'Not allowed',price:1},403);await send({op:'lead',name:'Creative lead',phone:'1111111111'});
 console.log('PASS: Office API migration, lead, catalogue, layout, normal/GST serials, due, payment, return loss and stock, advance fulfilment, void, access; checks:',checks);
 throw Error('ROLLBACK_TEST');
});}catch(e){if(e.message!=='ROLLBACK_TEST')throw e;}finally{await sql.end();}
