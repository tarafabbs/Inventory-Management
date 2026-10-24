// A work round belongs to the permanent piece, not to a new stock entry.
export function artistWorkRecords(pieceId:string,transactions:any[],artisans:any[]){
 const rounds:any[]=[];
 const records=[...transactions].reverse().filter(t=>t.status==='CONFIRMED').sort((a,b)=>a.created_at.localeCompare(b.created_at));
 for(const tx of records){
  let rows:any[]=[];try{rows=JSON.parse(tx.snapshot)}catch{continue}
  const line=rows.find(p=>p.id===pieceId);if(!line)continue;
  const close=(id:string,status:string)=>{const r=[...rounds].reverse().find(r=>r.artisan_id===id&&!r.delivery);if(r){r.delivery=tx;r.delivery_line=line;r.status=status}};
  if(tx.type==='ARTIST_TRANSFER')close(line.from_artisan_id||line.artisan_id,'Transferred');
  if(['RETURN','REPRINT_RECEIVE'].includes(tx.type)){close(tx.artisan_id,'Delivered');continue}
  if(!['HANDOFF','ARTIST_TRANSFER','REPRINT_OUT'].includes(tx.type))continue;
  const id=tx.artisan_id||line.to_artisan_id,artist=artisans.find(a=>a.id===id);
  rounds.push({id:tx.id,artisan_id:id,artist:line.artisan_name||artist?.name||'Artist',work_type:line.artisan_work_type||artist?.work_type||'Not recorded',description:line.inspection_reason||tx.reason||line.artisan_work_description||artist?.work_description||'',issue:tx,line,delivery:null,status:'With artist'});
 }
 return {rounds,artistCount:new Set(rounds.map(r=>r.artisan_id)).size};
}
