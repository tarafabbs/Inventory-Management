// Barcode reservations are documents; only an inspected scan creates inventory.
import {canEditPreparedReceipt} from './rules';

export async function intakeOperation(ctx:any){
 const {op,v,db,add,guard,event,move,transaction,user,actor,time,uuid,fail}=ctx;
 if(op==='updatePreparedReceipt'){
  if(!v.id||typeof v.id!=='string')throw fail('Choose a bill to edit.');
  if(!v.reference?.trim())throw fail('Enter the bill / challan number.');
  if(v.reference.trim().length>200)throw fail('Keep the bill / challan number under 200 characters.');
  if(!v.received_at||!Number.isFinite(Date.parse(v.received_at)))throw fail('Enter a valid arrival date.');
  if(typeof v.notes!=='string'||v.notes.length>2000)throw fail('Keep bill notes under 2,000 characters.');
  const quantity=Number(v.quantity);
  if(!Number.isInteger(quantity)||quantity<1||quantity>400)throw fail('Use a whole quantity from 1 to 400.');
  const lot=await db.prepare("SELECT * FROM lots WHERE id=? AND status<>'DRAFT'").bind(v.id).first();
  if(!lot)throw fail('This bill could not be found.',404);
  if(!canEditPreparedReceipt(user.role,lot.created_at,Date.parse(time)))throw fail('Workshop staff can edit a New Entry only within 24 hours. Ask an Admin to make an older correction.',403);
  const registeredRow=await db.prepare('SELECT COUNT(*)::int AS n FROM pieces WHERE lot_id=?').bind(lot.id).first();
  const pendingRow=await db.prepare("SELECT COUNT(*)::int AS n FROM generated_labels WHERE lot_id=? AND state='PENDING'").bind(lot.id).first();
  const registered=Number(registeredRow?.n||0),oldPending=Number(pendingRow?.n||0);
  if(quantity<registered)throw fail(`This bill already has ${registered} scanned pieces. Quantity cannot be lower than that.`,409);
  if(registered&&(v.company_id!==lot.company_id||v.product_id!==lot.product_id||lot.thanwala_id&&(v.thanwala_id||null)!==lot.thanwala_id))throw fail('Company, product and a saved Thanwala cannot change after a barcode from this bill has been scanned.',409);
  const c=await db.prepare('SELECT * FROM companies WHERE id=?').bind(v.company_id).first();
  const product=await db.prepare('SELECT * FROM products WHERE id=?').bind(v.product_id).first();
  if(!c||(!c.active&&c.id!==lot.company_id))throw fail('Choose an active company, association or own brand.');
  if(!product||(!product.active&&product.id!==lot.product_id))throw fail('Choose an active product.');
  const thanwala=c.ownership==='OWN'?await db.prepare('SELECT * FROM thanwalas WHERE id=?').bind(v.thanwala_id).first():null;
  if(c.ownership==='OWN'&&(!thanwala||(!thanwala.active&&thanwala.id!==lot.thanwala_id)))throw fail('Choose an active Thanwala for TaraFabbs Own Product.');
  if(c.ownership==='EXTERNAL'&&v.thanwala_id)throw fail('Thanwala applies only to TaraFabbs Own Product.');
  guard("SELECT COUNT(*)=1 FROM lots WHERE id=? AND company_id=? AND product_id=? AND thanwala_id IS NOT DISTINCT FROM ? AND reference=? AND received_at=? AND stated=? AND accepted=? AND notes=? AND (SELECT COUNT(*) FROM pieces WHERE lot_id=?)=? AND (SELECT COUNT(*) FROM generated_labels WHERE lot_id=? AND state='PENDING')=?",lot.id,lot.company_id,lot.product_id,lot.thanwala_id||null,lot.reference,lot.received_at,lot.stated,lot.accepted,lot.notes,lot.id,registered,lot.id,oldPending);
  if(!lot.thanwala_id&&thanwala){add('UPDATE generated_labels SET thanwala_id=? WHERE lot_id=? AND thanwala_id IS NULL',thanwala.id,lot.id);add('UPDATE pieces SET thanwala_id=? WHERE lot_id=? AND thanwala_id IS NULL',thanwala.id,lot.id);}
  add("UPDATE generated_labels SET state='VOIDED' WHERE lot_id=? AND state='PENDING'",lot.id);
  add('UPDATE lots SET company_id=?,product_id=?,ownership=?,thanwala_id=?,reference=?,received_at=?,stated=?,accepted=?,notes=? WHERE id=?',c.id,product.id,c.ownership,thanwala?.id||null,v.reference.trim(),v.received_at,quantity,quantity,v.notes.trim(),lot.id);
  const replacementCount=quantity-registered;
  if(replacementCount){
   add('UPDATE companies SET sequence=sequence+? WHERE id=?',replacementCount,c.id);
   for(let i=0;i<replacementCount;i++)add("INSERT INTO generated_labels(id,code,company_id,product_id,lot_id,ownership,thanwala_id,state,created_at) SELECT ?,prefix||'-'||lpad((sequence-?+?)::text,6,'0'),?,?,?,?,?,'PENDING',? FROM companies WHERE id=?",uuid(),replacementCount,i+1,c.id,product.id,lot.id,c.ownership,thanwala?.id||null,time,c.id);
  }
  return {ok:true,id:lot.id,count:replacementCount,registered,regenerated:replacementCount>0};
 }
 if(op==='prepareReceipt'){
  if(!v.reference?.trim())throw fail('Enter the bill / challan number.');
  if(!v.received_at||!Number.isFinite(Date.parse(v.received_at)))throw fail('Enter a valid arrival date.');
  if(!Array.isArray(v.items)||!v.items.length||v.items.length>20)throw fail('Add 1–20 product lines.');
  const count=v.items.reduce((n:number,i:any)=>n+Number(i.quantity),0);
  if(v.items.some((i:any)=>!Number.isInteger(i.quantity)||i.quantity<1)||count>400)throw fail('Use whole quantities, up to 400 labels per bill.');
  const c=await db.prepare('SELECT * FROM companies WHERE id=? AND active=1').bind(v.company_id).first();
  if(!c)throw fail('Choose an active company, association or own brand.');
  if(v.source_type&&!['OWN','EXTERNAL'].includes(v.source_type))throw fail('Choose Jobwork Company or TaraFabbs Own Product.');
  if(v.source_type&&c.ownership!==v.source_type)throw fail('The selected source does not match the New Entry source type.');
  const thanwala=c.ownership==='OWN'?await db.prepare('SELECT * FROM thanwalas WHERE id=? AND active=1').bind(v.thanwala_id).first():null;
  if(c.ownership==='OWN'&&!thanwala)throw fail('Choose an active Thanwala for TaraFabbs Own Product.');
  if(c.ownership==='EXTERNAL'&&v.thanwala_id)throw fail('Thanwala applies only to TaraFabbs Own Product.');
  guard('SELECT COUNT(*)=1 FROM companies WHERE id=? AND active=1',c.id);
  if(thanwala)guard('SELECT COUNT(*)=1 FROM thanwalas WHERE id=? AND active=1',thanwala.id);
  const ids=[];
  for(const item of v.items){
   const product=await db.prepare('SELECT * FROM products WHERE id=? AND active=1').bind(item.product_id).first();if(!product)throw fail('Choose an active product for every line.');
   const id=uuid(),number=`LOT-${time.slice(0,4)}-${id.slice(0,6).toUpperCase()}`;ids.push(id);
   add('INSERT INTO lots(id,number,company_id,product_id,ownership,thanwala_id,received_at,reference,stated,accepted,damaged,rejected,reason,notes,status,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,0,?,?,?, ?,?)',id,number,c.id,product.id,c.ownership,thanwala?.id||null,v.received_at,v.reference.trim(),item.quantity,item.quantity,'',v.notes||'','PREPARED',actor,time);
   add('UPDATE companies SET sequence=sequence+? WHERE id=?',item.quantity,c.id);
   for(let i=0;i<item.quantity;i++)add("INSERT INTO generated_labels(id,code,company_id,product_id,lot_id,ownership,thanwala_id,state,created_at) SELECT ?,prefix||'-'||lpad((sequence-?+?)::text,6,'0'),?,?,?,?,?,'PENDING',? FROM companies WHERE id=?",uuid(),item.quantity,i+1,c.id,product.id,id,c.ownership,thanwala?.id||null,time,c.id);
  }
  return {ok:true,count,ids};
 }
 if(!['intake','supplierReturn','dispute'].includes(op))return null;
 if(!Array.isArray(v.lines)||!v.lines.length||v.lines.length>100||new Set(v.lines.map((l:any)=>l.id)).size!==v.lines.length)throw fail('Scan 1–100 distinct pieces.');
 if(op==='intake'){
  const staged=[];
  for(const line of v.lines){
   if(!['OK','DAMAGED'].includes(line.outcome))throw fail('Check Condition OK or Condition Damaged before inventory entry.');
   if(line.outcome==='DAMAGED'&&!line.reason?.trim())throw fail('Describe why this saree is damaged.');
   const label=await db.prepare('SELECT g.*,c.name AS company_name,p.name AS product_name,l.number AS lot_number FROM generated_labels g JOIN companies c ON c.id=g.company_id JOIN products p ON p.id=g.product_id JOIN lots l ON l.id=g.lot_id WHERE g.id=?').bind(line.id).first();
   const legacy=label?null:await db.prepare("SELECT g.*,c.name AS company_name,p.name AS product_name,l.number AS lot_number FROM pieces g JOIN companies c ON c.id=g.company_id JOIN products p ON p.id=g.product_id JOIN lots l ON l.id=g.lot_id WHERE g.id=? AND g.condition='PENDING_LABEL_CONFIRMATION'").bind(line.id).first();
   if((!label&&!legacy)||(label&&label.state!=='PENDING'))throw fail('This barcode is unknown or already entered.',409);
   const p=label||legacy;if(v.lot_id&&p.lot_id!==v.lot_id)throw fail('This barcode belongs to a different bill / lot.');
   staged.push({p,line,legacy});
  }
  const tx=transaction('INTAKE',null,v.reason||'Physical label attached and condition checked',staged.map(({p,line}:any)=>({...p,outcome:line.outcome,inspection_reason:line.reason||''})));
  for(const {p,line,legacy} of staged){
   const condition=line.outcome==='OK'?'AVAILABLE':'DAMAGED';
   if(legacy){guard("SELECT COUNT(*)=1 FROM pieces WHERE id=? AND version=? AND condition='PENDING_LABEL_CONFIRMATION'",p.id,p.version);add('UPDATE pieces SET condition=?,label_confirmed_at=?,version=version+1 WHERE id=?',condition,time,p.id);}
   else {guard("SELECT COUNT(*)=1 FROM generated_labels WHERE id=? AND state='PENDING'",p.id);add("INSERT INTO pieces(id,code,company_id,product_id,lot_id,ownership,thanwala_id,holder,condition,label_confirmed_at,version,created_at) VALUES(?,?,?,?,?,?,?,'IN_HOUSE',?,?,1,?)",p.id,p.code,p.company_id,p.product_id,p.lot_id,p.ownership,p.thanwala_id||null,condition,time,time);add('UPDATE generated_labels SET state=?,registered_at=? WHERE id=?',condition,time,p.id);}
   event(p,'INTAKE',legacy?p:null,{...p,holder:'IN_HOUSE',artisan_id:null,condition,label_confirmed_at:time},line.reason||'Condition OK; attached barcode scanned',tx);
   add('INSERT INTO transaction_items(id,transaction_id,piece_id,before_state,after_state) VALUES(?,?,?,?,?)',uuid(),tx,p.id,JSON.stringify(legacy||null),JSON.stringify({...p,holder:'IN_HOUSE',condition,label_confirmed_at:time}));
  }
  return {ok:true,id:tx,count:staged.length};
 }
 const staged=[];
 for(const line of v.lines){
  const p=await db.prepare('SELECT g.*,c.name AS company_name,p.name AS product_name,l.number AS lot_number,t.name AS thanwala_name FROM pieces g JOIN companies c ON c.id=g.company_id JOIN products p ON p.id=g.product_id JOIN lots l ON l.id=g.lot_id LEFT JOIN thanwalas t ON t.id=g.thanwala_id WHERE g.id=?').bind(line.id).first();
  if(!p||p.version!==line.version)throw fail('A piece changed since scanning. Refresh and scan again.',409);
  if(!line.reason?.trim()&&!v.reason?.trim())throw fail('Record a reason for every damaged / disputed / returned piece.');
  if(op==='supplierReturn'){
   if(p.holder==='FACTORY_RETURN_PENDING')throw fail('Factory Staff must receive this office/customer return before another movement.',409);
   if(p.holder==='RETURNED_TO_SOURCE'||!['DAMAGED','DISPUTED','NEEDS_REWORK'].includes(p.condition))throw fail('Only damaged, disputed or rework pieces can be returned to source.',409);
   if(p.ownership==='OWN'){
    if(!p.thanwala_id)throw fail('This older Own Product has no Thanwala saved. Ask Admin or Supervisor to edit its New Entry first.');
    if(!v.thanwala_id||p.thanwala_id!==v.thanwala_id)throw fail('Scan only pieces purchased from the selected Thanwala.');
   }else if(!v.company_id||p.company_id!==v.company_id)throw fail('Scan only pieces belonging to the selected source company.');
  }else if(!['WITH_ARTISAN','IN_HOUSE'].includes(p.holder)||!p.label_confirmed_at||p.condition==='DISPUTED')throw fail('This piece cannot be disputed again in its current state.');
  if(op==='dispute'&&v.artisan_id&&p.artisan_id!==v.artisan_id)throw fail('This piece is not with the selected artisan.');
  staged.push({p,line});
 }
 const type=op==='supplierReturn'?'SUPPLIER_RETURN':'DISPUTE';
 const tx=transaction(type,v.artisan_id||null,v.reason||staged.map((s:any)=>`${s.p.code}: ${s.line.reason}`).join('; '),staged.map(({p,line}:any)=>({...p,inspection_reason:line.reason||v.reason})));
 for(const {p,line} of staged){
  const reason=line.reason||v.reason;
  const after=op==='supplierReturn'?{...p,holder:'RETURNED_TO_SOURCE',artisan_id:null}:{...p,condition:'DISPUTED'};
  move(p,type,after,reason,tx);
  if(op==='supplierReturn')add("UPDATE exceptions SET status='RESOLVED',resolution=? WHERE status='OPEN' AND (title LIKE ? OR detail LIKE ?)",`${actor} · ${time} · Returned to origin in ${tx}`,`%${p.code}%`,`%${p.code}%`);
  if(op==='dispute')add('INSERT INTO exceptions(id,title,detail,status,actor,created_at) VALUES(?,?,?,?,?,?)',uuid(),`Dispute · ${p.code}`,`${reason} · Artisan: ${p.artisan_id||'In house'} · Transaction: ${tx}`,'OPEN',actor,time);
 }
 return {ok:true,id:tx,count:staged.length};
}
