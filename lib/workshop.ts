export const generalGroundStaffId='warehouse-ground-staff';
export const workshopTypes:Record<string,string>={artistTransfer:'ARTIST_TRANSFER',groundSend:'GROUND_ISSUE',groundDispute:'GROUND_DISPUTE',reprintOut:'REPRINT_OUT',reprintReceive:'REPRINT_RECEIVE',finishReceive:'FINISH_RECEIVE',stockDispute:'STOCK_DISPUTE'};
export function workshopError(p:any,op:string,v:any){
 if(!p||!p.label_confirmed_at)return 'Scan a registered and inspected saree.';
 if(p.holder==='RETURNED_TO_SOURCE')return 'This saree has already been returned to its origin.';
 if(op==='artistTransfer'){
  if(!v.from_artisan_id||!v.artisan_id||v.from_artisan_id===v.artisan_id)return 'Choose two different artists.';
  if(p.holder!=='WITH_ARTISAN'||p.artisan_id!==v.from_artisan_id)return 'This saree is not with the selected sending artist.';
  if(!['AVAILABLE','ACCEPTED_WORK'].includes(p.condition))return 'Receive and resolve disputed or reprint work before transferring it.';
 }
 if(op==='groundSend'&&(p.holder!=='IN_HOUSE'||!['AVAILABLE','ACCEPTED_WORK'].includes(p.condition)))return 'Only inspected in-house fresh or artist-delivered sarees can go to finishing.';
 if(['groundDispute','finishReceive'].includes(op)&&(p.holder!=='GROUND_STAFF'||v.ground_staff_id&&p.ground_staff_id!==v.ground_staff_id))return 'This saree is not in the current Ground Staff finishing stock.';
 if(op==='groundDispute'&&['DAMAGED','DISPUTED'].includes(p.condition))return 'This finishing dispute is already recorded.';
 if(op==='reprintOut'){
  const disputed=['DAMAGED','DISPUTED','NEEDS_REWORK'].includes(p.condition);
  if(!disputed)return 'Record the damage, dispute or rework finding before sending this saree for reprint.';
 }
 if(op==='reprintReceive'&&(p.holder!=='WITH_ARTISAN'||p.artisan_id!==v.artisan_id||p.condition!=='REPRINTING'))return 'Scan only reprint sarees held by the selected artist.';
 if(op==='stockDispute'&&(p.holder!=='IN_HOUSE'||['DAMAGED','DISPUTED','PENDING_LABEL_CONFIRMATION'].includes(p.condition)))return 'Scan an in-house saree that has not already been marked damaged or disputed.';
 return '';
}

export async function workshopOperation(ctx:any){
 const {op,v,db,add,guard,move,transaction,uuid,fail,actor,time}=ctx;
 if(op==='groundStaff'){
  if(v.id===generalGroundStaffId)throw fail('The warehouse Ground Staff pool is managed automatically.');
  if(!v.name?.trim())throw fail('Enter the Ground Staff member name.');
  const id=v.id||uuid();if(v.id){const staff=await db.prepare('SELECT * FROM ground_staff WHERE id=?').bind(id).first();if(!staff)throw fail('Ground Staff record not found.');if(!v.active){const held=await db.prepare('SELECT COUNT(*)::int AS n FROM pieces WHERE ground_staff_id=?').bind(id).first();if(held.n)throw fail('Receive outstanding finishing pieces before archiving this staff member.');guard('SELECT COUNT(*)=0 FROM pieces WHERE ground_staff_id=?',id);}add('UPDATE ground_staff SET name=?,contact=?,active=? WHERE id=?',v.name.trim(),v.contact||'',v.active?1:0,id);}else add('INSERT INTO ground_staff(id,name,contact,active) VALUES(?,?,?,1)',id,v.name.trim(),v.contact||'');
  return {ok:true,id};
 }
 if(!workshopTypes[op])return null;
 if(!Array.isArray(v.lines)||!v.lines.length||v.lines.length>100||new Set(v.lines.map((l:any)=>l.id)).size!==v.lines.length)throw fail('Scan 1–100 different sarees.');
 let staff:any=null,artist:any=null,fromArtist:any=null;
 if(op==='groundSend'&&!v.ground_staff_id){staff={id:generalGroundStaffId,name:'Ground Staff',active:1};add('INSERT INTO ground_staff(id,name,contact,active) VALUES(?,?,?,1) ON CONFLICT(id) DO NOTHING',staff.id,staff.name,'');guard('SELECT COUNT(*)=1 FROM ground_staff WHERE id=? AND active=1',staff.id);}
 else if(['groundSend','groundDispute','finishReceive'].includes(op)&&v.ground_staff_id){staff=await db.prepare('SELECT * FROM ground_staff WHERE id=? AND active=1').bind(v.ground_staff_id).first();if(!staff)throw fail('This Ground Staff record is not active.');guard('SELECT COUNT(*)=1 FROM ground_staff WHERE id=? AND active=1',staff.id);}
 if(['artistTransfer','reprintOut','reprintReceive'].includes(op)){artist=await db.prepare('SELECT * FROM artisans WHERE id=? AND active=1').bind(v.artisan_id||'').first();if(!artist)throw fail('Choose an active receiving / reprint artist.');guard('SELECT COUNT(*)=1 FROM artisans WHERE id=? AND active=1',artist.id);}
 if(op==='artistTransfer'){fromArtist=await db.prepare('SELECT * FROM artisans WHERE id=? AND active=1').bind(v.from_artisan_id||'').first();if(!fromArtist)throw fail('Choose the current sending artist.');guard('SELECT COUNT(*)=1 FROM artisans WHERE id=? AND active=1',fromArtist.id);}
 const staged=[];
 for(const line of v.lines){
  const p=await db.prepare('SELECT p.*,c.name AS company_name,pr.name AS product_name,l.number AS lot_number,g.name AS ground_staff_name,a.name AS current_artisan_name FROM pieces p JOIN companies c ON c.id=p.company_id JOIN products pr ON pr.id=p.product_id JOIN lots l ON l.id=p.lot_id LEFT JOIN ground_staff g ON g.id=p.ground_staff_id LEFT JOIN artisans a ON a.id=p.artisan_id WHERE p.id=?').bind(line.id).first();
  if(!p||p.version!==line.version)throw fail('A scanned saree changed. Refresh and rescan the whole list.',409);
  const error=workshopError(p,op,v);if(error)throw fail(p.code+': '+error,409);
  if(['artistTransfer','groundDispute','stockDispute'].includes(op)&&!line.reason?.trim())throw fail('Record a reason / work description for each saree.');
  if(op==='reprintOut'){line.outcome='OK';line.reason=line.reason?.trim()||`Reprint requested from ${String(p.condition).toLowerCase().replaceAll('_',' ')} status`;}
  const receiving=['reprintReceive','finishReceive'].includes(op),dispute=['groundDispute','stockDispute'].includes(op);
  if(!receiving&&!dispute&&line.outcome!=='OK')throw fail('Confirm Condition OK / identity checked for each outgoing saree.');
  if(receiving&&!['OK','DAMAGED','DISPUTED','NEEDS_REWORK'].includes(line.outcome))throw fail('Inspect every returned saree before confirmation.');
  if(dispute&&!['DAMAGED','DISPUTED'].includes(line.outcome))throw fail('Choose Damage or Dispute.');
  if((receiving&&line.outcome!=='OK'||dispute)&&!line.reason?.trim())throw fail('Describe every damaged / disputed / rework finding.');
  if(op==='finishReceive'&&p.condition!=='FINISHING'&&line.outcome==='OK'&&!line.reason?.trim())throw fail('Explain how the finishing dispute was resolved before accepting finished goods.');
  staged.push({p,line});
 }
 const type=workshopTypes[op],snapshot=staged.map(({p,line}:any)=>({...p,outcome:line.outcome,inspection_reason:line.reason||'',from_artisan_id:fromArtist?.id||p.artisan_id||null,from_artisan_name:fromArtist?.name||p.current_artisan_name||'',to_artisan_id:['artistTransfer','reprintOut'].includes(op)?artist.id:null,artisan_name:artist?.name||null,artisan_work_type:artist?.work_type||null,artisan_work_description:artist?.work_description||'',ground_staff_id:staff?.id||p.ground_staff_id||null,ground_staff_name:staff?.name||p.ground_staff_name||null}));
 const tx=transaction(type,artist?.id||null,v.reason||staged.map((s:any)=>s.line.reason||'').filter(Boolean).join('; '),snapshot);
 for(const {p,line} of staged){
  let after:any={...p};
  if(op==='artistTransfer')after={...p,artisan_id:artist.id};
  if(op==='reprintOut')after={...p,holder:'WITH_ARTISAN',artisan_id:artist.id,ground_staff_id:null,condition:'REPRINTING'};
  if(op==='groundSend')after={...p,holder:'GROUND_STAFF',artisan_id:null,ground_staff_id:staff.id,condition:'FINISHING'};
  if(['groundDispute','stockDispute'].includes(op))after={...p,condition:line.outcome};
  if(['finishReceive','reprintReceive'].includes(op))after={...p,holder:'IN_HOUSE',artisan_id:null,ground_staff_id:null,condition:line.outcome==='OK'?(op==='finishReceive'?'FINISHED':'ACCEPTED_WORK'):line.outcome};
  const reason=line.reason||(['groundSend'].includes(op)?'Issued to warehouse finishing':op==='finishReceive'?'Final quality check passed; finished goods received':'Reprint work received and inspected');
  move(p,type,after,reason,tx);
  if(op==='reprintOut'&&['DAMAGED','DISPUTED','NEEDS_REWORK'].includes(p.condition))add("UPDATE exceptions SET status='RESOLVED',resolution=? WHERE status='OPEN' AND (title LIKE ? OR detail LIKE ?)",`${actor} · ${time} · Routed to reprint in ${tx}`,`%${p.code}%`,`%${p.code}%`);
  if(['groundDispute','stockDispute'].includes(op)||['finishReceive','reprintReceive'].includes(op)&&line.outcome!=='OK')add('INSERT INTO exceptions(id,title,detail,status,actor,created_at) VALUES(?,?,?,?,?,?)',uuid(),`${line.outcome} · ${p.code}`,`${reason} · ${staff?'Ground Staff '+staff.name:artist?'Artist '+artist.name:p.ground_staff_name||'Warehouse'} · ${tx}`,'OPEN',actor,time);
 }
 return {ok:true,id:tx,count:staged.length};
}
