import {canEditOfficeEntry,permitted} from './rules';
const clean = (value:unknown) => String(value||'').trim();

export async function officeOperation(ctx:any){
 const {op,v,db,add,guard,event,move,transaction,actor,time,uuid,fail,user}=ctx;
 if(!['officeNewEntry','officeLabel','officeEntryEdit','officeMasterEdit'].includes(op))return null;

 if(op==='officeEntryEdit'){
  if(!permitted(user?.role,'officeEdit'))throw fail('Your role cannot edit Office New Entries.',403);
  const lot=await db.prepare("SELECT * FROM lots WHERE id=? AND journey='OFFICE'").bind(v.id||'').first();
  if(!lot)throw fail('Choose an Office New Entry. Workshop entries cannot be edited here.',404);
  if(!canEditOfficeEntry(user.role,lot.created_at,Date.parse(time)))throw fail('The 24-hour Office New Entry edit window has closed.',403);
  if(!v.expected||['reference','received_at','notes'].some(field=>String(v.expected[field]??'')!==String(lot[field]??'')))throw fail('This Office New Entry changed while you were editing. Reopen it and review the latest details.',409);
  const reference=clean(v.reference),receivedAt=clean(v.received_at),notes=clean(v.notes),reason=clean(v.reason);
  if(reference.length>200)throw fail('Keep the optional vendor bill / challan number under 200 characters.');
  if(!receivedAt||!Number.isFinite(Date.parse(receivedAt)))throw fail('Enter a valid office receipt date.');
  if(notes.length>2000)throw fail('Keep office entry notes under 2,000 characters.');
  if(reason.length<3||reason.length>2000)throw fail('Explain the Office entry correction in 3–2000 characters.');
  for(const field of ['company_id','product_id','ownership','journey','stated','accepted','quantity'])if(v[field]!=null&&String(v[field])!==String(lot[field]))throw fail('This correction can change only the optional bill number, receipt date and notes. Barcode quantities and source remain fixed.');
  if(reference===lot.reference&&receivedAt===lot.received_at&&notes===lot.notes)throw fail('Change a bill detail before saving a correction.');
  add("SELECT id FROM lots WHERE id=? AND journey='OFFICE' FOR UPDATE",lot.id);
  guard("SELECT COUNT(*)=1 FROM lots WHERE id=? AND journey='OFFICE' AND reference=? AND received_at=? AND notes=?",lot.id,lot.reference,lot.received_at,lot.notes);
  add("UPDATE lots SET reference=?,received_at=?,notes=? WHERE id=? AND journey='OFFICE'",reference,receivedAt,notes,lot.id);
  const before={reference:lot.reference,received_at:lot.received_at,notes:lot.notes},after={reference,received_at:receivedAt,notes};
  const tx=transaction('OFFICE_ENTRY_EDIT',null,`Office entry ${lot.number} corrected: ${reason}`,[{entity_type:'office_entry',lot_id:lot.id,lot_number:lot.number,before,after}]);
  return {ok:true,id:tx,lotId:lot.id};
 }

 if(op==='officeMasterEdit'){
  if(!permitted(user?.role,'officeMaster'))throw fail('Your role cannot edit office vendors or products.',403);
  const table=v.kind==='vendors'?'companies':v.kind==='products'?'products':'';
  if(!table||!v.id)throw fail('Choose an office-only vendor or product to edit.');
  const record=await db.prepare(`SELECT * FROM ${table} WHERE id=? AND office_only=1`).bind(v.id).first();
  if(!record)throw fail('This record belongs outside Office access.',403);
  for(const field of ['prefix','ownership','office_only','active'])if(v[field]!=null&&String(v[field])!==String(record[field]))throw fail('Office correction cannot change barcode prefixes, ownership, access scope or archive status.');
  const fields=table==='companies'?['name','contact']:['name','material','weave','color','design'];
  if(!v.expected||fields.some(field=>String(v.expected[field]??'')!==String(record[field]??'')))throw fail('This office record changed while you were editing. Reselect it and review the latest details.',409);
  const after:Record<string,string>={},before:Record<string,string>={};
  for(const field of fields){after[field]=clean(v[field]);before[field]=record[field]||'';if(after[field].length>(field==='name'?200:2000))throw fail(`Keep ${field} under ${field==='name'?200:2000} characters.`)}
  const reason=clean(v.reason);
  if(!after.name)throw fail('A name is required.');
  if(reason.length<3||reason.length>2000)throw fail('Explain the office record correction in 3–2000 characters.');
  if(fields.every(field=>after[field]===before[field]))throw fail('Change a record detail before saving a correction.');
  const duplicate=await db.prepare(`SELECT id FROM ${table} WHERE lower(name)=lower(?) AND id<>?${table==='products'?' AND office_only=1':''}`).bind(after.name,record.id).first();
  if(duplicate)throw fail('This name already exists. Use a distinct name for this office record.',409);
  add(`SELECT id FROM ${table} WHERE id=? AND office_only=1 FOR UPDATE`,record.id);
  guard(`SELECT COUNT(*)=1 FROM ${table} WHERE id=? AND office_only=1 AND ${fields.map(field=>`${field} IS NOT DISTINCT FROM ?`).join(' AND ')}`,record.id,...fields.map(field=>record[field]));
  add(`UPDATE ${table} SET ${fields.map(field=>`${field}=?`).join(',')} WHERE id=? AND office_only=1`,...fields.map(field=>after[field]),record.id);
  const tx=transaction('OFFICE_MASTER_EDIT',null,`Office ${v.kind==='vendors'?'vendor':'product'} ${before.name} corrected: ${reason}`,[{entity_type:v.kind,record_id:record.id,before,after}]);
  return {ok:true,id:tx,recordId:record.id};
 }

 if(op==='officeLabel'){
  const p:any=await db.prepare('SELECT p.*,c.name AS company_name,pr.name AS product_name,l.number AS lot_number FROM pieces p JOIN companies c ON c.id=p.company_id JOIN products pr ON pr.id=p.product_id JOIN lots l ON l.id=p.lot_id WHERE p.id=?').bind(v.id||'').first();
  if(!p)throw fail('This office barcode is not registered.',404);
  if(p.version!==v.version)throw fail('This barcode changed after scanning. Refresh and scan it again.',409);
  if(p.journey!=='OFFICE'||p.holder!=='OFFICE_PENDING'||p.condition!=='PENDING_LABEL_CONFIRMATION')throw fail('Only a pending outside-vendor office label can be confirmed here.',409);
  const reason='Outside-vendor label attached, scanned and submitted into office inventory';
  const tx=transaction('OFFICE_LABEL_CONFIRM',null,reason,[p]);
  move(p,'OFFICE_LABEL_CONFIRM',{...p,holder:'OFFICE_STOCK',condition:'FINISHED',label_confirmed_at:time,artisan_id:null,ground_staff_id:null},reason,tx);
  return {ok:true,id:tx,count:1};
 }

 const quantity=Number(v.quantity),reference=clean(v.reference),receivedAt=clean(v.received_at),notes=clean(v.notes);
 const referenceLabel=reference?`Bill / challan ${reference}`:'No bill / challan provided';
 if(!Number.isInteger(quantity)||quantity<1||quantity>400)throw fail('Use a whole quantity from 1 to 400.');
 if(reference.length>200)throw fail('Keep the optional vendor bill / challan number under 200 characters.');
 if(!receivedAt||!Number.isFinite(Date.parse(receivedAt)))throw fail('Enter a valid office receipt date.');
 if(notes.length>2000)throw fail('Keep office entry notes under 2,000 characters.');

 let company:any=null;
 if(v.company_id){
  company=await db.prepare('SELECT * FROM companies WHERE id=? AND active=1 AND office_only=1').bind(v.company_id).first();
  if(!company)throw fail('Choose an active outside vendor created for Office New Entry.');
 }else{
  const name=clean(v.vendor_name),prefix=clean(v.vendor_prefix).toUpperCase(),contact=clean(v.vendor_contact);
  if(!name)throw fail('Enter the outside vendor name.');
  if(!/^[A-Z]{2,6}$/.test(prefix))throw fail('Use a unique vendor prefix of 2–6 uppercase letters.');
  if(await db.prepare('SELECT id FROM companies WHERE lower(name)=lower(?) OR prefix=?').bind(name,prefix).first())throw fail('This vendor name or barcode prefix already exists. Select it or use another prefix.',409);
  company={id:uuid(),name,prefix,ownership:'EXTERNAL',contact,sequence:0,office_only:1,active:1};
  add("INSERT INTO companies(id,name,prefix,ownership,contact,office_only) VALUES(?,?,?,'EXTERNAL',?,1)",company.id,name,prefix,contact);
 }

 let product:any=null;
 if(v.product_id){
  product=await db.prepare('SELECT * FROM products WHERE id=? AND active=1 AND office_only=1').bind(v.product_id).first();
  if(!product)throw fail('Choose an active office-only product.');
 }else{
  const name=clean(v.product_name);
  if(!name)throw fail('Enter the office product name.');
  if(await db.prepare('SELECT id FROM products WHERE lower(name)=lower(?) AND office_only=1').bind(name).first())throw fail('This office product already exists. Select it from the list.',409);
  product={id:uuid(),name,material:clean(v.material),weave:clean(v.weave),color:clean(v.color),design:clean(v.design),office_only:1,active:1};
  add('INSERT INTO products(id,name,material,weave,color,design,office_only) VALUES(?,?,?,?,?,?,1)',product.id,product.name,product.material,product.weave,product.color,product.design);
 }

 guard('SELECT COUNT(*)=1 FROM companies WHERE id=? AND active=1 AND office_only=1 AND sequence=?',company.id,company.sequence);
 guard('SELECT COUNT(*)=1 FROM products WHERE id=? AND active=1 AND office_only=1',product.id);
 const lotId=uuid(),number=`OFF-${time.slice(2,10).replaceAll('-','')}-${lotId.slice(0,6).toUpperCase()}`;
 add("INSERT INTO lots(id,number,company_id,product_id,ownership,journey,received_at,reference,stated,accepted,damaged,rejected,reason,notes,status,actor,created_at) VALUES(?,?,?,?,?,'OFFICE',?,?,?,?,0,0,'',?,'PREPARED',?,?)",lotId,number,company.id,product.id,'EXTERNAL',receivedAt,reference,quantity,quantity,notes,actor,time);
 add('UPDATE companies SET sequence=sequence+? WHERE id=?',quantity,company.id);
 const rows=[];
 for(let i=1;i<=quantity;i++){
  const id=uuid(),code=`${company.prefix}-${String(Number(company.sequence)+i).padStart(6,'0')}`;
  const piece={id,code,company_id:company.id,product_id:product.id,lot_id:lotId,ownership:'EXTERNAL',journey:'OFFICE',holder:'OFFICE_PENDING',condition:'PENDING_LABEL_CONFIRMATION',label_confirmed_at:null,version:1,created_at:time,company_name:company.name,product_name:product.name,lot_number:number};
  rows.push(piece);
  add("INSERT INTO pieces(id,code,company_id,product_id,lot_id,ownership,journey,holder,condition,version,created_at) VALUES(?,?,?,?,?,'EXTERNAL','OFFICE','OFFICE_PENDING','PENDING_LABEL_CONFIRMATION',1,?)",id,code,company.id,product.id,lotId,time);
  event(piece,'OFFICE_VENDOR_REGISTERED',null,piece,`${referenceLabel}; label reserved for office attachment`);
 }
 const tx=transaction('OFFICE_VENDOR_INTAKE',null,`Outside vendor ${company.name} · ${referenceLabel} · ${quantity} labels created`,rows);
 add('INSERT INTO print_jobs(id,codes,reason,actor,created_at,status,verified) VALUES(?,?,?,?,?,?,0)',uuid(),JSON.stringify(rows.map(p=>p.code)),`Office vendor intake · ${referenceLabel}`,actor,time,'REQUESTED');
 return {ok:true,id:tx,lotId,count:quantity,codes:rows.map(p=>p.code)};
}
