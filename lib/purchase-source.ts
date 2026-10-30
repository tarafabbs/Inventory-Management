import {permitted} from './rules';

// One-time legacy source identification; no barcode, quantity or custody changes.
export async function assignPurchaseSource(ctx:any){
 const {op,v,db,add,guard,event,transaction,user,actor,time,fail}=ctx;
 if(op!=='assignThanwala')return null;
 if(!permitted(user.role,'backfillThanwala'))throw fail('Your role cannot identify workshop purchase sources.',403);
 const piece=await db.prepare('SELECT * FROM pieces WHERE id=?').bind(v.id||'').first();
 if(!piece||piece.journey==='OFFICE'||piece.ownership!=='OWN'||!['IN_HOUSE','WITH_ARTISAN','GROUND_STAFF','EXCEPTION'].includes(piece.holder))throw fail('Choose an Own Product within workshop custody.',403);
 if(piece.version!==v.version||piece.thanwala_id)throw fail('This barcode changed or already has its purchase source saved. Refresh and review it.',409);
 const source=await db.prepare('SELECT * FROM thanwalas WHERE id=? AND active=1').bind(v.thanwala_id||'').first();
 if(!source)throw fail('Choose an active Thanwala.');
 const reason=String(v.reason||'').trim();if(v.verified!==true||reason.length<10||reason.length>2000)throw fail('Verify the original purchase source and describe the physical or bill evidence in 10–2000 characters.');
 const lot=await db.prepare('SELECT * FROM lots WHERE id=?').bind(piece.lot_id).first();
 if(!lot||lot.journey==='OFFICE'||lot.ownership!=='OWN'||lot.thanwala_id&&lot.thanwala_id!==source.id)throw fail('The source must match the original Own Product lot.',409);
 const {results:pieces}=await db.prepare('SELECT * FROM pieces WHERE lot_id=?').bind(lot.id).all();
 if(pieces.some((p:any)=>p.thanwala_id&&p.thanwala_id!==source.id))throw fail('This lot already contains a different saved purchase source.',409);
 const conflict=await db.prepare('SELECT COUNT(*)::int AS n FROM generated_labels WHERE lot_id=? AND thanwala_id IS NOT NULL AND thanwala_id<>?').bind(lot.id,source.id).first();
 if(Number(conflict?.n||0)>0)throw fail('This lot already contains a different saved purchase source.',409);
 const missing=pieces.filter((p:any)=>!p.thanwala_id);
 add('SELECT id FROM lots WHERE id=? FOR UPDATE',lot.id);
 guard('SELECT COUNT(*)=1 FROM lots WHERE id=? AND thanwala_id IS NOT DISTINCT FROM ?',lot.id,lot.thanwala_id||null);
 guard('SELECT COUNT(*)=1 FROM thanwalas WHERE id=? AND active=1',source.id);
 guard('SELECT COUNT(*)=0 FROM generated_labels WHERE lot_id=? AND thanwala_id IS NOT NULL AND thanwala_id<>?',lot.id,source.id);
 add('UPDATE lots SET thanwala_id=? WHERE id=? AND thanwala_id IS NULL',source.id,lot.id);
 add('UPDATE generated_labels SET thanwala_id=? WHERE lot_id=? AND thanwala_id IS NULL',source.id,lot.id);
 const note=`Purchase Thanwala identified as ${source.name} for ${lot.number}: ${reason}`;
 const tx=transaction('PURCHASE_SOURCE_ASSIGNED',null,note,missing.map((p:any)=>({...p,thanwala_name:source.name})));
 for(const p of missing){guard('SELECT COUNT(*)=1 FROM pieces WHERE id=? AND version=? AND thanwala_id IS NULL',p.id,p.version);add('UPDATE pieces SET thanwala_id=?,version=version+1 WHERE id=? AND thanwala_id IS NULL',source.id,p.id);event(p,'PURCHASE_SOURCE_ASSIGNED',p,{...p,thanwala_id:source.id,version:p.version+1},note,tx)}
 return {ok:true,id:tx,count:missing.length,source:source.name};
}
