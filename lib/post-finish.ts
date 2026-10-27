const movementTypes:Record<string,string>={
 jobworkDispatch:'JOBWORK_DISPATCH',
 jobworkReturn:'JOBWORK_DISPUTE_RETURN',
 officeSend:'OFFICE_SEND',
 officeReceive:'OFFICE_RECEIVE',
 officeSell:'OFFICE_SALE',
 officeReturn:'OFFICE_DISPUTE_RETURN',
 customerReturn:'CUSTOMER_DISPUTE_RETURN',
 factoryReceive:'FACTORY_DISPUTE_RECEIVE',
};

export async function postFinishOperation(ctx:any){
 const {op,v,db,add,move,transaction,uuid,fail,time,actor}=ctx;
 if(!movementTypes[op])return null;
 const p:any=await db.prepare('SELECT p.*,c.name AS company_name,pr.name AS product_name FROM pieces p JOIN companies c ON c.id=p.company_id JOIN products pr ON pr.id=p.product_id WHERE p.id=?').bind(v.id||'').first();
 if(!p)throw fail('This barcode is not registered.',404);
 if(p.version!==v.version)throw fail('This barcode changed after scanning. Refresh and scan it again.',409);

 const disputeReason=String(v.reason||'').trim();
 let after:any={...p},reason='';
 if(op==='jobworkDispatch'){
  if(p.holder!=='IN_HOUSE'||p.condition!=='FINISHED'||p.ownership!=='EXTERNAL')throw fail('Only finished jobwork-company products can be dispatched to their original company.',409);
  after={...p,holder:'JOBWORK_COMPANY',artisan_id:null,ground_staff_id:null};
  reason=`Finished product dispatched to ${p.company_name}`;
 }
 if(op==='officeSend'){
  if(p.holder!=='IN_HOUSE'||p.condition!=='FINISHED'||p.ownership!=='OWN')throw fail('Only finished TaraFabbs own products can be sent to the office.',409);
  after={...p,holder:'OFFICE_PENDING',artisan_id:null,ground_staff_id:null};
  reason='Finished TaraFabbs product sent to office; Office Staff confirmation pending';
 }
 if(op==='jobworkReturn'){
  if(p.holder!=='JOBWORK_COMPANY'||p.condition!=='FINISHED'||p.ownership!=='EXTERNAL')throw fail('Only a product currently dispatched to its original jobwork company can return as disputed.',409);
  if(v.disputed!==true)throw fail('Confirm that this is a disputed return from the company.');
  if(!disputeReason)throw fail('Record why the company returned this product.');
  after={...p,holder:'IN_HOUSE',condition:'DISPUTED',artisan_id:null,ground_staff_id:null};
  reason=`Disputed product returned from ${p.company_name}: ${disputeReason}`;
 }
 if(op==='officeReceive'){
  if(p.holder!=='OFFICE_PENDING'||p.condition!=='FINISHED'||p.ownership!=='OWN')throw fail('This TaraFabbs product is not awaiting Office Staff confirmation.',409);
  after={...p,holder:'OFFICE_STOCK',artisan_id:null,ground_staff_id:null};
  reason='Office Staff scanned and submitted the product into office inventory';
 }
 if(op==='officeSell'){
  if(p.holder!=='OFFICE_STOCK'||p.condition!=='FINISHED'||p.ownership!=='OWN')throw fail('Only confirmed TaraFabbs office stock can be marked sold out.',409);
  after={...p,holder:'SOLD',artisan_id:null,ground_staff_id:null};
  reason='Office Staff scanned and marked the product Sold Out';
 }
 if(op==='officeReturn'){
  if(p.holder!=='OFFICE_STOCK'||p.condition!=='FINISHED'||p.ownership!=='OWN')throw fail('Only confirmed office stock can be returned to the workshop as disputed.',409);
  if(v.disputed!==true)throw fail('Confirm that this office item is disputed.');
  if(!disputeReason)throw fail('Record why this office item is returning to the workshop.');
  after={...p,holder:'FACTORY_RETURN_PENDING',condition:'DISPUTED',artisan_id:null,ground_staff_id:null};
  reason=`Office dispute sent back to workshop; factory receipt pending: ${disputeReason}`;
 }
 if(op==='customerReturn'){
  if(p.holder!=='SOLD'||p.condition!=='FINISHED'||p.ownership!=='OWN')throw fail('Only a sold TaraFabbs product can be returned from a customer as disputed.',409);
  if(v.disputed!==true)throw fail('Confirm that this is a disputed return from the customer.');
  if(!disputeReason)throw fail('Record why the customer returned this product.');
  after={...p,holder:'FACTORY_RETURN_PENDING',condition:'DISPUTED',artisan_id:null,ground_staff_id:null};
  reason=`Disputed customer return sent to workshop; factory receipt pending: ${disputeReason}`;
 }
 if(op==='factoryReceive'){
  if(p.holder!=='FACTORY_RETURN_PENDING'||p.condition!=='DISPUTED'||p.ownership!=='OWN')throw fail('Only an office or customer dispute awaiting factory receipt can be received here.',409);
  if(v.received!==true)throw fail('Confirm that the physical product has reached the factory.');
  after={...p,holder:'IN_HOUSE',condition:'DISPUTED',artisan_id:null,ground_staff_id:null};
  reason='Factory Staff scanned and received the disputed return; ready for reprint or Ground Staff';
 }

 const type=movementTypes[op];
 const snapshot={...p,destination_company:p.company_name,dispute_reason:disputeReason||null};
 const tx=transaction(type,null,reason,[snapshot]);
 move(p,type,after,reason,tx);
 if(op==='factoryReceive'||op==='jobworkReturn')add('INSERT INTO exceptions(id,title,detail,status,actor,created_at) VALUES(?,?,?,?,?,?)',uuid(),`Disputed return · ${p.code}`,`${reason} · Ready for reprint or Ground Staff · ${tx}`,'OPEN',actor,time);
 return {ok:true,id:tx,count:1};
}
