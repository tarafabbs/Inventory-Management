// Barcode reservations are documents; only an inspected scan creates inventory.
export async function intakeOperation(ctx:any){
 const {op,v,db,add,guard,event,move,transaction,actor,time,uuid,fail}=ctx;
 if(op==='prepareReceipt'){
  if(!v.reference?.trim())throw fail('Enter the bill / challan number.');
  if(!v.received_at||!Number.isFinite(Date.parse(v.received_at)))throw fail('Enter a valid arrival date.');
  if(!Array.isArray(v.items)||!v.items.length||v.items.length>20)throw fail('Add 1–20 product lines.');
  const count=v.items.reduce((n:number,i:any)=>n+Number(i.quantity),0);
  if(v.items.some((i:any)=>!Number.isInteger(i.quantity)||i.quantity<1)||count>400)throw fail('Use whole quantities, up to 400 labels per bill.');
  const c=await db.prepare('SELECT * FROM companies WHERE id=? AND active=1').bind(v.company_id).first();
  if(!c)throw fail('Choose an active company, association or own brand.');
  guard('SELECT COUNT(*)=1 FROM companies WHERE id=? AND active=1',c.id);
  const ids=[];
  for(const item of v.items){
   const product=await db.prepare('SELECT * FROM products WHERE id=? AND active=1').bind(item.product_id).first();if(!product)throw fail('Choose an active product for every line.');
   const id=uuid(),number=`LOT-${time.slice(0,4)}-${id.slice(0,6).toUpperCase()}`;ids.push(id);
   add('INSERT INTO lots(id,number,company_id,product_id,ownership,received_at,reference,stated,accepted,damaged,rejected,reason,notes,status,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?,0,0,?,?,?, ?,?)',id,number,c.id,product.id,c.ownership,v.received_at,v.reference.trim(),item.quantity,item.quantity,'',v.notes||'','PREPARED',actor,time);
   add('UPDATE companies SET sequence=sequence+? WHERE id=?',item.quantity,c.id);
   for(let i=0;i<item.quantity;i++)add("INSERT INTO generated_labels(id,code,company_id,product_id,lot_id,ownership,state,created_at) SELECT ?,prefix||'-'||printf('%06d',sequence-?+?),?,?,?,?,'PENDING',? FROM companies WHERE id=?",uuid(),item.quantity,i+1,c.id,product.id,id,c.ownership,time,c.id);
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
   else {guard("SELECT COUNT(*)=1 FROM generated_labels WHERE id=? AND state='PENDING'",p.id);add("INSERT INTO pieces(id,code,company_id,product_id,lot_id,ownership,holder,condition,label_confirmed_at,version,created_at) VALUES(?,?,?,?,?,?,'IN_HOUSE',?,?,1,?)",p.id,p.code,p.company_id,p.product_id,p.lot_id,p.ownership,condition,time,time);add('UPDATE generated_labels SET state=?,registered_at=? WHERE id=?',condition,time,p.id);}
   event(p,'INTAKE',legacy?p:null,{...p,holder:'IN_HOUSE',artisan_id:null,condition,label_confirmed_at:time},line.reason||'Condition OK; attached barcode scanned',tx);
   add('INSERT INTO transaction_items(id,transaction_id,piece_id,before_state,after_state) VALUES(?,?,?,?,?)',uuid(),tx,p.id,JSON.stringify(legacy||null),JSON.stringify({...p,holder:'IN_HOUSE',condition,label_confirmed_at:time}));
  }
  return {ok:true,id:tx,count:staged.length};
 }
 const staged=[];
 for(const line of v.lines){
  const p=await db.prepare('SELECT g.*,c.name AS company_name,p.name AS product_name,l.number AS lot_number FROM pieces g JOIN companies c ON c.id=g.company_id JOIN products p ON p.id=g.product_id JOIN lots l ON l.id=g.lot_id WHERE g.id=?').bind(line.id).first();
  if(!p||p.version!==line.version)throw fail('A piece changed since scanning. Refresh and scan again.',409);
  if(!line.reason?.trim()&&!v.reason?.trim())throw fail('Record a reason for every damaged / disputed / returned piece.');
  if(op==='supplierReturn'){
   if(p.holder!=='IN_HOUSE'||!['DAMAGED','DISPUTED','NEEDS_REWORK'].includes(p.condition))throw fail('Only in-house damaged or disputed pieces can be returned to source.',409);
   if(!v.company_id||p.company_id!==v.company_id)throw fail('Scan only pieces belonging to the selected source company.');
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
  if(op==='dispute')add('INSERT INTO exceptions(id,title,detail,status,actor,created_at) VALUES(?,?,?,?,?,?)',uuid(),`Dispute · ${p.code}`,`${reason} · Artisan: ${p.artisan_id||'In house'} · Transaction: ${tx}`,'OPEN',actor,time);
 }
 return {ok:true,id:tx,count:staged.length};
}
