import {createHash,randomUUID} from 'node:crypto';
import {db} from '@/lib/database';
import {inventorySession,type InventoryUser} from '@/lib/inventory-identity';
import {accountKey,type Account,type Delta} from '@/lib/production';
import {isOwner,roleLabel} from '@/lib/rules';
import {defaultIncentiveRule,netOfficeDeltas,officeDay,officeFYear,officeNumber,officePaise,officeQuantity,officeReturnLoss,officeRoles,officeTax,returnReasons,sellingRoles,trimOffice,validOfficeDate,type OfficeDocument,type OfficeDocumentBody,type OfficeLine,type ReturnReason} from '@/lib/office-core';
import {officeRewards} from '@/lib/office-incentives';

export const dynamic='force-dynamic';
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const reject=(message:string,status=400)=>Object.assign(Error(message),{status});
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
type Fields=Record<string,unknown>;
type Employee={id:string;user_id:string|null;email:string;employee_code:string;role:string;manager_id:string|null;name:string;dob:string|null;phone:string;joining_date:string;photo:string;salary:number;half_month:boolean;conversion_target:number;retention_target:number;active:boolean};
type Product={id:string;name:string;stock_product:string|null;price:number;hsn:string;sku:string;approximate_profit:number;incentive_class:'normal'|'low'|'excluded';low_incentive:number;active:boolean};
type Lead={id:string;name:string;business_name:string;phone:string;whatsapp:string;address:string;gst:string;created_by:string;created_on:string;follow_up_date:string|null;notes:string;verified_at:string|null;purchases:number;average_monthly:number};

async function user(){const s=await inventorySession();if(!s.signedIn||!s.staff||!officeRoles.includes(s.staff.role))throw reject('Office access required.',403);return s.staff;}
const management=(u:InventoryUser)=>['Admin','Management','Office Manager'].includes(u.role);
const seller=(u:InventoryUser)=>sellingRoles.includes(u.role);
const profile=(u:InventoryUser,employees:Employee[])=>employees.find(e=>e.user_id===u.id);
function visibleUsers(u:InventoryUser,employees:Employee[]){
 if(management(u))return null;
 const self=profile(u,employees);if(!self)return new Set([u.id]);
 const ids=new Set([u.id]);let pending=[self.id];
 while(pending.length){const next=employees.filter(e=>e.manager_id&&pending.includes(e.manager_id));pending=next.map(e=>e.id);for(const e of next)if(e.user_id)ids.add(e.user_id);}
 return ids;
}
async function employees(tx:Tx){return (await tx.prepare('SELECT e.*,u.email,e.dob::text AS dob,e.joining_date::text AS joining_date,e.salary::float8 AS salary FROM inventory.office_employees e LEFT JOIN users u ON u.id=e.user_id ORDER BY e.employee_code').all<Employee>()).results;}
const canSee=(u:InventoryUser,ids:Set<string>|null,actor:string)=>!ids||ids.has(actor);
async function audit(tx:Tx,u:InventoryUser,action:string,label:string,data:unknown){await tx.prepare('INSERT INTO inventory.change_audit(actor_id,actor,actor_role,action,target_label,after_data) VALUES(?,?,?,?,?,?::text::jsonb)').bind(u.id,u.name,roleLabel(u.role),action,label,JSON.stringify(data)).run();}
function failure(error:unknown){const dbError='code' in Object(error);if(dbError)console.error('Office outlet database:',(error as {code?:string}).code);return response({error:error instanceof Error&&!dbError?error.message:'Office data could not be saved. Retry using the same form.'},(error as {status?:number})?.status||(dbError?503:400));}

export async function GET(request:Request){try{
 const u=await user(),q=new URL(request.url).searchParams;
 if(q.get('view')==='ifsc'){
  const ifsc=(q.get('ifsc')||'').trim().toUpperCase();
  if(!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc))throw Error('Enter a valid 11-character IFSC.');
  let checked:Response;
  try{checked=await fetch(`https://ifsc.razorpay.com/${ifsc}`,{cache:'no-store',signal:AbortSignal.timeout(8000)});}catch{throw reject('Could not check IFSC now. Please retry.',503);}
  if(checked.status===404)throw reject('IFSC not found. Check the code.',404);
  if(!checked.ok)throw reject('Could not check IFSC now. Please retry.',503);
  const info=await checked.json();
  if(info.IFSC!==ifsc||typeof info.BANK!=='string'||typeof info.BRANCH!=='string'||!info.BRANCH.trim())throw Error('Could not verify IFSC details.');
  return response({ifsc,bank:info.BANK.trim().slice(0,120),branch:info.BRANCH.trim().slice(0,120)});
 }
 const staff=await employees(db),ids=visibleUsers(u,staff);
 if(q.get('view')==='document'){
  const doc=await db.prepare('SELECT *,date::text AS date,total::float8 AS total,paid::float8 AS paid FROM inventory.office_documents WHERE id=?::uuid').bind(q.get('id')||'').first<OfficeDocument>();
  if(!doc||(u.role==='Production Manager'?!doc.body.advance||doc.kind!=='bill':!canSee(u,ids,doc.actor_id)))return response({error:'Bill not found.'},404);
  return response(doc);
 }
 if(q.get('view')==='returns'){
  const customer=q.get('customer')||'';
  const docs=(await db.prepare("SELECT id,number,date::text,actor_id,body FROM inventory.office_documents WHERE customer=?::uuid AND kind='bill' AND voided_at IS NULL ORDER BY date DESC,created_at DESC").bind(customer).all<{id:string;number:string;date:string;actor_id:string;body:OfficeDocumentBody}>()).results;
  return response(docs.filter(d=>canSee(u,ids,d.actor_id)).map(d=>({id:d.id,number:d.number,date:d.date,lines:d.body.lines.filter(l=>l.dispatched>0)})));
 }
 const leads=await db.prepare(`SELECT l.*,l.created_on::text,l.follow_up_date::text,
    (SELECT min(d.date)::text FROM inventory.office_documents d WHERE d.customer=l.id AND d.kind='bill' AND d.voided_at IS NULL) AS verified_at,
    (SELECT count(*)::int FROM inventory.office_documents d WHERE d.customer=l.id AND d.kind='bill' AND d.voided_at IS NULL) AS purchases,
    (SELECT coalesce(sum(d.total),0)::float8 FROM inventory.office_documents d WHERE d.customer=l.id AND d.kind='bill' AND d.voided_at IS NULL) AS lifetime_total
    FROM inventory.office_leads l ORDER BY l.created_at DESC`).all<Lead & {lifetime_total:number}>();
 const products=await db.prepare('SELECT *,price::float8,approximate_profit::float8,low_incentive::float8 FROM inventory.office_products ORDER BY name').all<Product>();
 const documents=await db.prepare('SELECT id,kind,number,date::text,customer,actor_id,gst,total::float8,paid::float8,revision,status,original_bill,return_reason,voided_at,body FROM inventory.office_documents ORDER BY date DESC,created_at DESC LIMIT 5000').all<OfficeDocument>();
 const layout=await db.prepare('SELECT body FROM inventory.office_bill_layout WHERE singleton').first<{body:Record<string,string>}>();
 const rules=await db.prepare('SELECT body FROM inventory.office_incentive_rules WHERE singleton').first<{body:Record<string,unknown>}>();
 const money=await db.prepare(`SELECT customer,sum(amount)::float8 AS due FROM (
   SELECT customer,total-paid AS amount FROM inventory.office_documents WHERE voided_at IS NULL
   UNION ALL SELECT customer,amount FROM inventory.office_customer_money) x GROUP BY customer`).all<{customer:string;due:number}>();
 const advances=await db.prepare('SELECT id,employee,date::text,amount::float8,adjusted::float8,notes FROM inventory.office_advances ORDER BY date DESC').all();
 const cycles=await db.prepare('SELECT id,employee,period_start::text,period_end::text,salary::float8,incentive::float8,paid::float8,advance_adjusted::float8 FROM inventory.office_salary_cycles ORDER BY period_end DESC').all();
 const moneyRows=await db.prepare('SELECT id,customer,date::text,amount::float8,kind,method,notes FROM inventory.office_customer_money ORDER BY date,created_at').all<{id:string;customer:string;date:string;amount:number;kind:string;method:string;notes:string}>();
 const visibleLeads=u.role==='Production Manager'?[]:leads.results.filter(l=>canSee(u,ids,l.created_by));
 const visibleDocs=documents.results.filter(d=>u.role==='Production Manager'?d.kind==='bill'&&d.body.advance:canSee(u,ids,d.actor_id));
 const visibleEmployees=isOwner(u.role)||u.role==='Production Manager'?staff:staff.filter(e=>e.user_id===u.id||e.user_id&&canSee(u,ids,e.user_id));
 const salaryEmployees=isOwner(u.role)?new Set(staff.map(e=>e.id)):new Set(staff.filter(e=>e.user_id!==u.id&&e.user_id&&canSee(u,ids,e.user_id)).map(e=>e.id));
 const incentive=officeRewards(documents.results,staff,leads.results,rules?.body as unknown as typeof defaultIncentiveRule||defaultIncentiveRule);
 const visibleEmployeeIds=new Set(visibleEmployees.map(e=>e.id));
 return response({user:{id:u.id,name:u.name,role:u.role},employees:visibleEmployees.map(e=>salaryEmployees.has(e.id)||e.user_id===u.id?e:{...e,salary:0,email:''}),
  leads:visibleLeads,products:u.role==='Production Manager'?[]:products.results,
  documents:visibleDocs,layout:layout?.body||{},rules:isOwner(u.role)?rules?.body||defaultIncentiveRule:undefined,
  balances:money.results.filter(b=>visibleLeads.some(l=>l.id===b.customer)),
  moneyRows:moneyRows.results.filter(b=>visibleLeads.some(l=>l.id===b.customer)),
  advances:advances.results.filter((a:any)=>salaryEmployees.has(a.employee)),
  cycles:cycles.results.filter((c:any)=>salaryEmployees.has(c.employee)),
  incentives:incentive.rewards.filter(r=>visibleEmployeeIds.has(r.employee)),targets:incentive.targets.filter(r=>visibleEmployeeIds.has(r.employee)),
  currentDate:officeDay()});
}catch(error){return failure(error);}}

async function nextNumber(tx:Tx,kind:string,gst:boolean,date:string){const series=kind==='return'?(gst?'OGR':'OR'):(gst?'OG':'O'),year=officeFYear(date);const row=await tx.prepare(`INSERT INTO inventory.office_bill_sequences(series,fiscal_year,last_number) VALUES(?,?,1)
 ON CONFLICT(series,fiscal_year) DO UPDATE SET last_number=inventory.office_bill_sequences.last_number+1 RETURNING last_number`).bind(series,year).first<{last_number:number}>();if(!row)throw Error('Could not allocate bill number.');return officeNumber(series,year,row.last_number);}
async function postStock(tx:Tx,u:InventoryUser,document:string,date:string,reference:string,deltas:Delta[],kind:string){
 const net=netOfficeDeltas(deltas);if(!net.length)return;
 for(const d of net){const key=accountKey(d),row=await tx.prepare('SELECT quantity FROM inventory.production_balances WHERE key=? FOR UPDATE').bind(key).first<{quantity:number}>(),next=(row?.quantity||0)+d.quantity;
  if(next<0)throw reject('Office stock is insufficient. Refresh and check the quantity.',409);
  if(row)await tx.prepare('UPDATE inventory.production_balances SET quantity=?,since=CASE WHEN quantity=0 THEN clock_timestamp() ELSE since END WHERE key=?').bind(next,key).run();
  else await tx.prepare('INSERT INTO inventory.production_balances(key,company,product,pool,stage,artisan,arts,work,quantity) VALUES(?,?,?,?,?,?,?,?,?)').bind(key,d.company,d.product,d.pool,d.stage,d.artisan,d.arts,d.work,next).run();
 }
 await tx.prepare('INSERT INTO inventory.production_events(kind,company,event_date,reference,notes,actor_id,actor,actor_role,payload,delta) VALUES(?,?,?::date,?,?,?,?,?,?::text::jsonb,?::text::jsonb)')
 .bind(kind,net[0].company,date,reference,'Office outlet bill '+reference,u.id,u.name,roleLabel(u.role),JSON.stringify({officeDocument:document}),JSON.stringify(net)).run();
}
async function stockSource(tx:Tx,key:string){const source=await tx.prepare(`SELECT b.company,b.product,b.pool,b.stage,b.artisan,b.arts,b.work,b.quantity,c.ownership,c.office_only,p.name
 FROM inventory.production_balances b JOIN inventory.companies c ON c.id=b.company JOIN inventory.products p ON p.id=b.product WHERE b.key=? FOR UPDATE`).bind(key).first<Account&{quantity:number;ownership:string;office_only:number;name:string}>();
 if(!source||source.ownership!=='OWN'||source.office_only||source.pool!=='normal'||source.stage!=='office_stock')throw Error('Choose TaraFabbs Own Product stock in the Office.');return source;}
async function document(tx:Tx,id:string,revision?:unknown){const row=await tx.prepare('SELECT *,date::text,total::float8,paid::float8 FROM inventory.office_documents WHERE id=?::uuid FOR UPDATE').bind(id).first<OfficeDocument>();if(!row||row.voided_at)throw reject('Bill not found or deleted.',404);if(revision!==undefined&&row.revision!==revision)throw reject('Bill changed. Reopen it before saving.',409);return row;}
async function revision(tx:Tx,u:InventoryUser,d:OfficeDocument,operation:string){await tx.prepare('INSERT INTO inventory.office_document_revisions(document,revision,operation,actor_id,snapshot) VALUES(?::uuid,?,?,?,?::text::jsonb)').bind(d.id,d.revision,operation,u.id,JSON.stringify(d)).run();}
async function lead(tx:Tx,id:string){const row=await tx.prepare('SELECT id,name,business_name,phone,whatsapp,address,gst,created_by FROM inventory.office_leads WHERE id=?::uuid').bind(id).first<Lead>();if(!row)throw Error('Choose a saved lead.');return row;}
async function mutate(tx:Tx,u:InventoryUser,v:Fields){
 const all=await employees(tx),actor=profile(u,all),scope=visibleUsers(u,all),id=randomUUID();
 switch(v.op){
  case 'lead':{
   if(!seller(u))throw reject('Only the selling team can manage leads.',403);
   const name=trimOffice(v.name,120,'lead name',true),phone=trimOffice(v.phone,30,'calling number',true),business=trimOffice(v.businessName,120,'business name');
   const whatsapp=v.sameWhatsapp===true?phone:trimOffice(v.whatsapp,30,'WhatsApp number');
   const address=trimOffice(v.address,800,'address'),gst=trimOffice(v.gst,15,'GSTIN').toUpperCase(),notes=trimOffice(v.notes,2000,'follow-up notes');
   const follow=v.followUp?validOfficeDate(v.followUp,true):null;
   if(gst&&!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gst))throw Error('Enter a valid GSTIN.');
   const previous=v.id?await lead(tx,String(v.id)):null;if(previous&&!canSee(u,scope,previous.created_by))throw reject('This lead belongs to another team.',403);
   const target=previous?.id||id;
   await tx.prepare(`INSERT INTO inventory.office_leads(id,name,business_name,phone,whatsapp,address,gst,created_by,follow_up_date,notes)
    VALUES(?::uuid,?,?,?,?,?,?,?,?::date,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,business_name=excluded.business_name,
    phone=excluded.phone,whatsapp=excluded.whatsapp,address=excluded.address,gst=excluded.gst,
    follow_up_date=excluded.follow_up_date,notes=excluded.notes,updated_at=clock_timestamp()`)
    .bind(target,name,business,phone,whatsapp,address,gst,u.id,follow,notes).run();
   await audit(tx,u,'office_lead',name,{id:target,follow});return {id:target};
  }
  case 'product':{
   if(!['Admin','Management','Office Manager','Assistant Manager'].includes(u.role))throw reject('Manager access required.',403);
   const name=trimOffice(v.name,120,'product name',true),price=officePaise(v.price,'price'),hsn=trimOffice(v.hsn,8,'HSN'),sku=trimOffice(v.sku,80,'SKU');
   if(hsn&&!/^\d{4,8}$/.test(hsn))throw Error('HSN must have 4–8 digits.');
   const stockProduct=trimOffice(v.stockProduct,120,'stock category');if(stockProduct&&!await tx.prepare("SELECT id FROM products WHERE id=? AND office_only=0").bind(stockProduct).first())throw Error('Choose a factory product category.');
   const old=v.id?await tx.prepare('SELECT * FROM inventory.office_products WHERE id=?::uuid').bind(String(v.id)).first<Product>():null;
   const incentiveClass=isOwner(u.role)&&['normal','low','excluded'].includes(String(v.incentiveClass))?String(v.incentiveClass):old?.incentive_class||'normal';
   const lowIncentive=isOwner(u.role)?officePaise(v.lowIncentive||0):Number(old?.low_incentive||0);
   const target=old?.id||id;
   await tx.prepare(`INSERT INTO inventory.office_products(id,name,stock_product,price,hsn,sku,approximate_profit,incentive_class,low_incentive)
    VALUES(?::uuid,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,stock_product=excluded.stock_product,
    price=excluded.price,hsn=excluded.hsn,sku=excluded.sku,approximate_profit=excluded.approximate_profit,
    incentive_class=excluded.incentive_class,low_incentive=excluded.low_incentive`)
    .bind(target,name,stockProduct||null,price,hsn,sku,officePaise(v.profit||0,'approximate profit'),incentiveClass,lowIncentive).run();
   await audit(tx,u,'office_product',name,{id:target});return {id:target};
  }
  case 'layout':{
   if(!management(u))throw reject('Owner or Manager can edit bill layout.',403);
   const body=Object.fromEntries(['seller','address','phone','gst','bankName','accountNumber','ifsc','branch','logo','signature','qr'].map(key=>[key,trimOffice(v[key],key==='logo'||key==='signature'||key==='qr'?220000:1200,key)]));
   if([body.bankName,body.accountNumber,body.ifsc,body.branch].some(Boolean)){
    if(!body.bankName||!/^[0-9]{6,25}$/.test(body.accountNumber)||!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(body.ifsc)||!body.branch)throw Error('Enter bank name, 6–25 digit account number, valid IFSC and detected branch.');
   }
   await tx.prepare('INSERT INTO inventory.office_bill_layout(singleton,body) VALUES(true,?::text::jsonb) ON CONFLICT(singleton) DO UPDATE SET body=excluded.body').bind(JSON.stringify(body)).run();
   await audit(tx,u,'office_bill_layout',body.seller,{});return {id:'layout'};
  }
  case 'employee':{
   if(!['Admin','Management','Office Manager','Assistant Manager'].includes(u.role))throw reject('Manager access required.',403);
   const role=String(v.role||'');if(!['Office Manager','Assistant Manager','Office Staff','Production Manager'].includes(role))throw Error('Choose an Office role.');
   if((role==='Office Manager'||role==='Production Manager')&&!isOwner(u.role))throw reject('Only Owner creates Manager or Production Manager.',403);
   if(u.role==='Assistant Manager'&&role!=='Office Staff')throw reject('Assistant Manager can create Creative Team Members only.',403);
   const name=trimOffice(v.name,120,'employee name',true),phone=trimOffice(v.phone,30,'phone'),email=trimOffice(v.email,200,'Google email',true).toLowerCase();
   if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw Error('Enter the employee Google email.');
   const dob=v.dob?validOfficeDate(v.dob):null,joining=validOfficeDate(v.joiningDate||officeDay());
   const photo=trimOffice(v.photo,220000,'profile photo');if(photo&&!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo))throw Error('Upload a PNG, JPEG or WebP photo.');
   const old=v.id?all.find(e=>e.id===v.id):undefined;
   if(old&&!isOwner(u.role)&&old.manager_id!==actor?.id)throw reject('Only the direct manager may edit this profile.',403);
   if(old&&old.role!==role)throw Error('Employee role cannot change in this profile. Use Staff Access.');
   const boss=isOwner(u.role)?String(v.managerId||''):(actor?.id||'');
   if(!isOwner(u.role)&&!boss)throw Error('Create your own manager profile first.');
   if(boss&&!all.some(e=>e.id===boss&&e.active))throw Error('Choose an active manager.');
   if(role==='Office Staff'&&boss&&!['Assistant Manager','Office Manager'].includes(all.find(e=>e.id===boss)?.role||''))throw Error('Creative Team Member needs a Manager or Assistant Manager.');
   if(role==='Assistant Manager'&&boss&&all.find(e=>e.id===boss)?.role!=='Office Manager')throw Error('Assistant Manager must report to a Manager.');
   const existingUser=await tx.prepare('SELECT id,role FROM users WHERE lower(email)=?').bind(email).first<{id:string;role:string}>();
   if(existingUser&&existingUser.role!==role)throw Error('This Google email already has another role in Staff Access.');
   if(old&&existingUser&&existingUser.id!==old.user_id)throw Error('This email belongs to a different employee profile.');
   if(old&&!existingUser)throw Error('Change employee login email in Staff Access before editing this profile.');
   if(!old&&existingUser&&all.some(e=>e.user_id===existingUser.id))throw Error('This Google email already has an Office profile.');
   const userId=existingUser?.id||randomUUID();
   if(!existingUser)await tx.prepare('INSERT INTO users(id,email,name,role,active,created_at) VALUES(?,?,?,?,1,?)').bind(userId,email,name,role,new Date().toISOString()).run();
   const salary=officePaise(v.salary||0,'salary');
   const conversionTarget=Number(v.conversionTarget||0),retentionTarget=Number(v.retentionTarget||0);
   if(!Number.isSafeInteger(conversionTarget)||conversionTarget<0||conversionTarget>100||!Number.isSafeInteger(retentionTarget)||retentionTarget<0||retentionTarget>100)throw Error('Set weekly targets as percentages from 0 to 100.');
   const target=old?.id||id;
   await tx.prepare(`INSERT INTO inventory.office_employees(id,user_id,role,manager_id,name,dob,phone,joining_date,photo,salary,half_month,conversion_target,retention_target)
    VALUES(?::uuid,?,?,?::uuid,?,?::date,?,?::date,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET manager_id=excluded.manager_id,
    name=excluded.name,dob=excluded.dob,phone=excluded.phone,joining_date=excluded.joining_date,photo=excluded.photo,
    salary=excluded.salary,half_month=excluded.half_month,conversion_target=excluded.conversion_target,retention_target=excluded.retention_target`)
    .bind(target,userId,role,boss||null,name,dob,phone,joining,photo,salary,v.halfMonth===true,conversionTarget,retentionTarget).run();
   await audit(tx,u,'office_employee',name,{id:target,role,boss});return {id:target};
  }
  case 'rules':{
   if(!isOwner(u.role))throw reject('Only Owner sets incentives.',403);
   const body={...defaultIncentiveRule,...Object.fromEntries(Object.keys(defaultIncentiveRule).map(k=>[k,Number(v[k]??(defaultIncentiveRule as unknown as Record<string,number>)[k])]))};
   if(Object.values(body).some(n=>!Number.isSafeInteger(n)||n<0||n>1e7))throw Error('Check incentive rules.');
   await tx.prepare('INSERT INTO inventory.office_incentive_rules(singleton,body) VALUES(true,?::text::jsonb) ON CONFLICT(singleton) DO UPDATE SET body=excluded.body').bind(JSON.stringify(body)).run();
   await audit(tx,u,'office_incentive_rules','Office rules',body);return {id:'rules'};
  }
  case 'bill': return saveBill(tx,u,v,scope);
  case 'dispatch': return dispatch(tx,u,v,scope);
  case 'payment': return payment(tx,u,v,scope);
  case 'return': return returnBill(tx,u,v,scope);
  case 'void':{
   if(!seller(u))throw reject('Selling team access required.',403);
   const old=await document(tx,String(v.id),v.revision);
   if(!canSee(u,scope,old.actor_id))throw reject('This bill belongs to another team.',403);
   if(v.confirm!==true)throw Error('Confirm bill deletion.');
   if(await tx.prepare('SELECT id FROM inventory.office_documents WHERE original_bill=?::uuid AND voided_at IS NULL LIMIT 1').bind(old.id).first())throw Error('Reverse linked returns before deleting this bill.');
   await revision(tx,u,old,'deleted');
   await postStock(tx,u,old.id,officeDay(),old.number,old.stock_delta.map(d=>({...d,quantity:-d.quantity})),'office_bill_void');
   await tx.prepare('UPDATE inventory.office_documents SET voided_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE id=?::uuid').bind(old.id).run();
   return {id:old.id};
  }
  case 'advance':{
   if(!management(u)&&u.role!=='Assistant Manager')throw reject('Manager access required.',403);
   const employee=all.find(e=>e.id===v.employee);if(!employee||(!isOwner(u.role)&&employee.manager_id!==actor?.id))throw reject('Choose a direct report.',403);
   const amount=officePaise(v.amount,'advance');if(!amount)throw Error('Enter an advance.');
   await tx.prepare('INSERT INTO inventory.office_advances(id,employee,date,amount,notes,approved_by) VALUES(?::uuid,?,?::date,?,?,?)').bind(id,employee.id,validOfficeDate(v.date),amount,trimOffice(v.notes,800,'notes'),u.id).run();
   return {id};
  }
  case 'openingDue':{
   if(!management(u))throw reject('Owner or Manager access required.',403);
   const customer=await lead(tx,String(v.customer||'')),amount=officePaise(v.amount,'opening due');
   if(!amount)throw Error('Enter an opening due.');
   await tx.prepare("INSERT INTO inventory.office_customer_money(id,customer,date,amount,kind,method,notes,actor_id) VALUES(?::uuid,?::uuid,?::date,?,'opening','',?,?) ON CONFLICT(customer) WHERE kind='opening' DO UPDATE SET date=excluded.date,amount=excluded.amount,notes=excluded.notes")
    .bind(id,customer.id,validOfficeDate(v.date),amount,trimOffice(v.notes,800,'notes'),u.id).run();
   await audit(tx,u,'office_opening_due',customer.name,{amount});return {id};
  }
  case 'salary': return salaryPayment(tx,u,v,all,actor);
  default:throw Error('Choose an Office action.');
 }
}

async function saveBill(tx:Tx,u:InventoryUser,v:Fields,scope:Set<string>|null){
 if(!seller(u))throw reject('Selling team access required.',403);
 const previous=v.id?await document(tx,String(v.id),v.revision):null;
 if(previous&&!canSee(u,scope,previous.actor_id))throw reject('This bill belongs to another team.',403);
 if(previous&&(previous.kind!=='bill'||previous.body.lines.some(l=>l.dispatched>0&&previous.body.advance)))throw Error('A dispatched advance bill cannot be edited. Use a return or adjustment.');
 if(previous&&await tx.prepare("SELECT id FROM inventory.office_documents WHERE original_bill=?::uuid AND voided_at IS NULL LIMIT 1").bind(previous.id).first())throw Error('This bill has returns. Reverse the return before editing it.');
 const customer=await lead(tx,String(v.customer||''));if(!canSee(u,scope,customer.created_by))throw reject('Choose a lead in your team.',403);
 if(previous&&previous.customer!==customer.id)throw Error('Customer cannot change after billing.');
 const date=validOfficeDate(v.date),gst=v.gst===true;
 if(previous&&previous.gst!==gst)throw Error('Bill GST type cannot change after saving.');
 const cgstRate=gst?officePaise(v.cgst||0):0,sgstRate=gst?officePaise(v.sgst||0):0,igstRate=gst?officePaise(v.igst||0):0;
 if(cgstRate+sgstRate+igstRate>10000)throw Error('Tax rates must total at most 100%.');
 if(gst&&(!customer.gst||!customer.address))throw Error('Save customer GSTIN and address on the lead first.');
 const layout=(await tx.prepare('SELECT body FROM inventory.office_bill_layout WHERE singleton').first<{body:Record<string,string>}>())?.body||{};
 if(gst&&(!layout.gst||!layout.address))throw Error('Save outlet GSTIN and address in Bill Layout first.');
 const input=Array.isArray(v.lines)?v.lines:[];if(!input.length||input.length>100)throw Error('Add 1–100 products.');
 const lines:OfficeLine[]=[];
 for(const value of input){const row=value as Fields,quantity=officeQuantity(row.quantity),unit=officePaise(row.unit,'price');
  const item=await tx.prepare('SELECT *,price::float8,approximate_profit::float8,low_incentive::float8 FROM inventory.office_products WHERE id=?::uuid AND active').bind(String(row.product||'')).first<Product>();
  if(!item)throw Error('Choose a saved Office product.');
  let source:Account|undefined;
  if(item.stock_product){const found=await stockSource(tx,String(row.source||''));if(found.product!==item.stock_product)throw Error('Product and stock category do not match.');
   source={company:found.company,product:found.product,pool:found.pool,stage:found.stage,artisan:found.artisan,arts:found.arts,work:found.work};}
  const hsn=gst?trimOffice(row.hsn||item.hsn,8,'HSN',true):'';if(gst&&!/^\d{4,8}$/.test(hsn))throw Error('Each GST product needs a 4–8 digit HSN.');
  lines.push({id:previous?.body.lines[lines.length]?.id||randomUUID(),product:item.id,name:item.name,quantity,unit,hsn,sku:item.sku,source,
   dispatched:v.advance===true?0:quantity,paymentReceived:v.advance!==true,
   profit:item.approximate_profit||Math.round(unit*5/100),incentiveClass:item.incentive_class,lowIncentive:item.low_incentive});
 }
 const subtotal=lines.reduce((n,l)=>n+l.quantity*l.unit,0),discount=officePaise(v.discount||0),additional=officePaise(v.additional||0);
 const amounts=officeTax(subtotal,discount,additional,cgstRate,sgstRate,igstRate);
 const paid=officePaise(v.paid||0,'payment');if(paid>amounts.total)throw Error('Payment cannot exceed bill total.');
 const advance=v.advance===true,deadline=advance?validOfficeDate(v.deadline,true):'';
 if(advance&&deadline<date)throw Error('Order deadline cannot precede bill date.');
 const number=previous?.number||await nextNumber(tx,'bill',gst,date),id=previous?.id||randomUUID();
 const body:OfficeDocumentBody={customer,lines,layout,gst,cgstRate,sgstRate,igstRate,discount,additional,
  notes:trimOffice(v.notes,1200,'notes'),advance,deadline,paymentMethod:trimOffice(v.method,50,'payment method'),loss:0};
 const delta=advance?[]:netOfficeDeltas(lines.filter(l=>l.source).map(l=>({...l.source!,quantity:-l.quantity})));
 if(previous)await revision(tx,u,previous,'before edit');
 await postStock(tx,u,id,date,number,netOfficeDeltas([...previous?.stock_delta.map(d=>({...d,quantity:-d.quantity}))||[],...delta]),previous?'office_bill_edit':'office_bill');
 await tx.prepare(`INSERT INTO inventory.office_documents(id,kind,number,date,customer,actor_id,gst,body,stock_delta,total,paid,status)
  VALUES(?::uuid,'bill',?,?::date,?::uuid,?,?,?::text::jsonb,?::text::jsonb,?,?,?)
  ON CONFLICT(id) DO UPDATE SET date=excluded.date,body=excluded.body,stock_delta=excluded.stock_delta,total=excluded.total,
  paid=excluded.paid,status=excluded.status,revision=inventory.office_documents.revision+1,updated_at=clock_timestamp()`)
  .bind(id,number,date,customer.id,u.id,gst,JSON.stringify(body),JSON.stringify(delta),amounts.total,paid,advance?'open':'settled').run();
 await audit(tx,u,previous?'office_bill_edit':'office_bill',number,{id,total:amounts.total});return {id,number};
}

async function dispatch(tx:Tx,u:InventoryUser,v:Fields,scope:Set<string>|null){
 if(!seller(u)&&u.role!=='Production Manager')throw reject('Order access required.',403);
 const old=await document(tx,String(v.id),v.revision);if(old.kind!=='bill'||!old.body.advance)throw Error('Choose an open advance bill.');
 if(u.role!=='Production Manager'&&!canSee(u,scope,old.actor_id))throw reject('This order belongs to another team.',403);
 const index=Number(v.line),line=old.body.lines[index];if(!line)throw Error('Choose an order line.');
 if(u.role==='Production Manager'&&v.paymentReceived===true&&!line.paymentReceived)throw reject('Selling team must confirm payment first.',403);
 const paid=v.paymentReceived===true||line.paymentReceived;
 const quantity=v.quantity===undefined?0:officeQuantity(v.quantity);
 if(quantity&&!paid)throw Error('Mark payment received before dispatch.');
 if(line.dispatched+quantity>line.quantity)throw Error('Dispatch exceeds ordered quantity.');
 const next={...old,body:{...old.body,lines:old.body.lines.map((row,i)=>i===index?{...row,dispatched:row.dispatched+quantity,paymentReceived:paid}:row)}};
 const delta=quantity&&line.source?[{...line.source,quantity:-quantity}]:[];
 await postStock(tx,u,old.id,officeDay(),old.number,delta,'office_order_dispatch');
 next.stock_delta=netOfficeDeltas([...old.stock_delta,...delta]);next.status=next.body.lines.every(l=>l.dispatched===l.quantity)?'settled':'open';
 await revision(tx,u,old,'before dispatch');
 await tx.prepare('UPDATE inventory.office_documents SET body=?::text::jsonb,stock_delta=?::text::jsonb,status=?,revision=revision+1,updated_at=clock_timestamp() WHERE id=?::uuid')
 .bind(JSON.stringify(next.body),JSON.stringify(next.stock_delta),next.status,old.id).run();
 return {id:old.id,status:next.status};
}
async function payment(tx:Tx,u:InventoryUser,v:Fields,scope:Set<string>|null){
 if(!seller(u))throw reject('Selling team access required.',403);
 const old=await document(tx,String(v.id),v.revision);if(!canSee(u,scope,old.actor_id))throw reject('This bill belongs to another team.',403);
 const amount=officePaise(v.amount,'payment');if(!amount||old.paid+amount>Math.abs(old.total))throw Error('Payment exceeds remaining due.');
 await revision(tx,u,old,'before payment');
 await tx.prepare('UPDATE inventory.office_documents SET paid=paid+?,revision=revision+1,updated_at=clock_timestamp() WHERE id=?::uuid').bind(amount,old.id).run();
 return {id:old.id};
}
async function returnBill(tx:Tx,u:InventoryUser,v:Fields,scope:Set<string>|null){
 if(!seller(u))throw reject('Selling team access required.',403);
 const previous=v.id?await document(tx,String(v.id),v.revision):null;
 if(previous&&(previous.kind!=='return'||!canSee(u,scope,previous.actor_id)))throw reject('Choose your return bill to edit.',403);
 const original=await document(tx,String(v.bill));if(original.kind!=='bill'||!canSee(u,scope,original.actor_id))throw reject('Choose a customer bill in your team.',403);
 if(previous&&previous.original_bill!==original.id)throw Error('Original bill cannot change on a saved return.');
 const customer=await lead(tx,original.customer),reason=String(v.reason||'') as ReturnReason;
 if(!returnReasons.includes(reason))throw Error('Choose a return reason.');
 const index=Number(v.line),line=original.body.lines[index];if(!line||line.dispatched<1)throw Error('Choose a dispatched product.');
 const prior=(await tx.prepare("SELECT body FROM inventory.office_documents WHERE original_bill=?::uuid AND kind='return' AND voided_at IS NULL AND id<>?::uuid").bind(original.id,previous?.id||randomUUID()).all<{body:OfficeDocumentBody}>()).results;
 const already=prior.reduce((n,d)=>n+d.body.lines.filter(l=>l.id===line.id).reduce((s,l)=>s+l.quantity,0),0);
 const quantity=officeQuantity(v.quantity);if(quantity+already>line.dispatched)throw Error('Return exceeds delivered quantity.');
 const unit=officePaise(v.unit??line.unit/100,'return price');
 const saleValue=quantity*line.unit,loss=officeReturnLoss(reason,saleValue),refund=Math.max(0,quantity*unit-loss);
 const cash=v.resolution==='cash',replacement=v.resolution==='replacement';if(!cash&&!replacement)throw Error('Choose cash return or replacement order.');
 const replacementProduct=replacement?await tx.prepare('SELECT *,price::float8 FROM inventory.office_products WHERE id=?::uuid AND active').bind(String(v.replacementProduct||'')).first<Product>():null;
 if(replacement&&!replacementProduct)throw Error('Choose a replacement product.');
 const replacementQty=replacement?officeQuantity(v.replacementQuantity):0;
 const replacementUnit=replacement?officePaise(v.replacementUnit??Number(replacementProduct!.price)/100):0;
 let replacementSource:Account|undefined;
 if(replacementProduct?.stock_product){const found=await stockSource(tx,String(v.replacementSource||''));if(found.product!==replacementProduct.stock_product)throw Error('Replacement product and stock do not match.');replacementSource={company:found.company,product:found.product,pool:found.pool,stage:found.stage,artisan:found.artisan,arts:found.arts,work:found.work};}
 const returnedSource=line.source?{...line.source,stage:reason.includes('DISPUTE')?'hold' as const:'office_stock' as const}:undefined;
 const delta=netOfficeDeltas([...(returnedSource?[{...returnedSource,quantity}]:[]),...(replacementSource?[{...replacementSource,quantity:-replacementQty}]:[])]);
 const date=validOfficeDate(v.date),gst=original.gst,number=previous?.number||await nextNumber(tx,'return',gst,date),id=previous?.id||randomUUID();
 const body:OfficeDocumentBody={...original.body,lines:[{...line,quantity,unit,source:returnedSource,dispatched:quantity}],advance:false,deadline:'',
  notes:trimOffice(v.notes,1200,'notes'),loss,paymentMethod:cash?'Cash return':'Replacement',
  replacement:replacementProduct?{product:replacementProduct.id,name:replacementProduct.name,quantity:replacementQty,unit:replacementUnit,source:replacementSource}:undefined};
 const total=-(refund-replacementQty*replacementUnit),paid=cash?-refund:0;
 if(previous)await revision(tx,u,previous,'before return edit');
 await postStock(tx,u,id,date,number,netOfficeDeltas([...previous?.stock_delta.map(d=>({...d,quantity:-d.quantity}))||[],...delta]),previous?'office_customer_return_edit':'office_customer_return');
 await tx.prepare(`INSERT INTO inventory.office_documents(id,kind,number,date,customer,actor_id,gst,body,stock_delta,total,paid,status,original_bill,return_reason)
  VALUES(?::uuid,'return',?,?::date,?::uuid,?,?,?::text::jsonb,?::text::jsonb,?,?,'settled',?::uuid,?)
  ON CONFLICT(id) DO UPDATE SET date=excluded.date,body=excluded.body,stock_delta=excluded.stock_delta,total=excluded.total,
  paid=excluded.paid,return_reason=excluded.return_reason,revision=inventory.office_documents.revision+1,updated_at=clock_timestamp()`)
  .bind(id,number,date,customer.id,u.id,gst,JSON.stringify(body),JSON.stringify(delta),total,paid,original.id,reason).run();
 await audit(tx,u,'office_customer_return',number,{original:original.number,loss});return {id,number};
}
async function salaryPayment(tx:Tx,u:InventoryUser,v:Fields,all:Employee[],actor:Employee|undefined){
 if(!management(u)&&u.role!=='Assistant Manager')throw reject('Manager access required.',403);
 const employee=all.find(e=>e.id===v.employee);if(!employee||(!isOwner(u.role)&&employee.manager_id!==actor?.id))throw reject('Choose a direct report.',403);
 const start=validOfficeDate(v.start),end=validOfficeDate(v.end),salary=officePaise(v.salary??employee.salary/100,'salary'),amount=officePaise(v.amount,'salary payment'),adjust=officePaise(v.adjust||0,'advance adjustment');
 if(end<start||!amount&&!adjust)throw Error('Check the salary period and amount.');
 const outstanding=(await tx.prepare('SELECT coalesce(sum(amount-adjusted),0)::float8 AS amount FROM inventory.office_advances WHERE employee=?::uuid').bind(employee.id).first<{amount:number}>())?.amount||0;
 if(adjust>outstanding)throw Error('Advance adjustment exceeds outstanding advances.');
 const docs=(await tx.prepare("SELECT id,kind,number,date::text,customer,actor_id,gst,body,total::float8,paid::float8,status,voided_at FROM inventory.office_documents WHERE kind='bill'").all<OfficeDocument>()).results;
 const leads=(await tx.prepare('SELECT id,created_by,created_on::text FROM inventory.office_leads').all<{id:string;created_by:string;created_on:string}>()).results;
 const savedRules=await tx.prepare('SELECT body FROM inventory.office_incentive_rules WHERE singleton').first<{body:typeof defaultIncentiveRule}>();
 const incentive=officeRewards(docs,all,leads,savedRules?.body||defaultIncentiveRule).rewards.filter(r=>r.employee===employee.id&&r.date>=start&&r.date<=end).reduce((n,r)=>n+r.amount,0);
 const cycle=await tx.prepare(`INSERT INTO inventory.office_salary_cycles(employee,period_start,period_end,salary,incentive)
  VALUES(?::uuid,?::date,?::date,?,?) ON CONFLICT(employee,period_start,period_end) DO UPDATE SET salary=excluded.salary,incentive=excluded.incentive RETURNING id,paid::float8,advance_adjusted::float8,salary::float8,incentive::float8`)
  .bind(employee.id,start,end,salary,incentive).first<{id:string;paid:number;advance_adjusted:number;salary:number;incentive:number}>();
 if(!cycle||cycle.paid+cycle.advance_adjusted+amount+adjust>salary+incentive)throw Error('Salary and incentive payment exceeds due.');
 await tx.prepare('UPDATE inventory.office_salary_cycles SET paid=paid+?,advance_adjusted=advance_adjusted+? WHERE id=?::uuid').bind(amount,adjust,cycle.id).run();
 if(amount)await tx.prepare('INSERT INTO inventory.office_salary_payments(cycle,amount,advance_adjusted,date,actor_id) VALUES(?::uuid,?,?,?::date,?)').bind(cycle.id,amount,adjust,officeDay(),u.id).run();
 if(adjust){let left=adjust;const advances=(await tx.prepare('SELECT id,amount::float8,adjusted::float8 FROM inventory.office_advances WHERE employee=?::uuid AND adjusted<amount ORDER BY date,created_at FOR UPDATE').bind(employee.id).all<{id:string;amount:number;adjusted:number}>()).results;
  for(const advance of advances){const applied=Math.min(left,advance.amount-advance.adjusted);await tx.prepare('UPDATE inventory.office_advances SET adjusted=adjusted+? WHERE id=?::uuid').bind(applied,advance.id).run();left-=applied;if(!left)break;}}
 await audit(tx,u,'office_salary_payment',employee.name,{cycle:cycle.id,amount,adjust,incentive});return {id:cycle.id};
}

export async function POST(request:Request){try{
 if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)throw reject('Use the inventory site.',403);
 const u=await user(),raw=await request.text();if(raw.length>1_200_000)throw reject('Resize uploaded images.',413);
 const input=JSON.parse(raw),key=String(input.key||'');if(!/^[a-f\d-]{36}$/i.test(key))throw Error('Reload this form.');
 const fingerprint=createHash('sha256').update(raw).digest('hex');
 const result=await db.transaction(async tx=>{
  await tx.prepare("SELECT pg_advisory_xact_lock(hashtextextended('production-posting',0))").run();
  if(!await tx.prepare('SELECT id FROM users WHERE id=? AND role=? AND active=1 FOR SHARE').bind(u.id,u.role).first())throw reject('Your access changed.',403);
  const prior=await tx.prepare('SELECT fingerprint,actor_id,result FROM inventory.production_requests WHERE id=?').bind(key).first<{fingerprint:string;actor_id:string;result:unknown}>();
  if(prior){if(prior.fingerprint!==fingerprint||prior.actor_id!==u.id)throw reject('This request belongs to another entry.',409);return prior.result;}
  const {key:_,...values}=input;
  const saved=await mutate(tx,u,values);
  await tx.prepare('INSERT INTO inventory.production_requests(id,actor_id,fingerprint,result) VALUES(?,?,?,?::text::jsonb)').bind(key,u.id,fingerprint,JSON.stringify(saved)).run();
  return saved;
 });return response(result);
}catch(error){return failure(error);}}
