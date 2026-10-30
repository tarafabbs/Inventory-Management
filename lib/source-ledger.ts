const terminalHolders=new Set(['RETURNED_TO_SOURCE','SOLD']);
const outsideWorkshopCheck=new Set(['RETURNED_TO_SOURCE','JOBWORK_COMPANY','OFFICE_PENDING','OFFICE_STOCK','SOLD','FACTORY_RETURN_PENDING']);

function snapshot(transaction:any){
 try{const value=JSON.parse(transaction.snapshot||'[]');return Array.isArray(value)?value:[]}catch{return []}
}

function countByType(movements:any[],type:string){
 return movements.filter(row=>row.type===type&&row.status==='CONFIRMED').reduce((sum,row)=>sum+row.count,0);
}

function uniqueRecords(records:any[]){
 const byId=new Map<string,any>();
 for(const record of records){const key=record.id||record.code;if(key)byId.set(key,record)}
 return [...byId.values()];
}

export function buildSourceLedgers(data:any){
 const companies=data.companies||[],thanwalas=data.thanwalas||[],products=data.products||[],artisans=data.artisans||[],lots=data.lots||[],pieces=data.pieces||[],labels=(data.generatedLabels||[]).filter((label:any)=>label.state==='PENDING'||label.condition==='PENDING_LABEL_CONFIRMATION'),transactions=data.transactions||[];
 const productNames=new Map(products.map((product:any)=>[product.id,product.name]));
 const artisanNames=new Map(artisans.map((artisan:any)=>[artisan.id,artisan.name]));
 const pieceIndex=new Map(uniqueRecords([...labels,...pieces]).map((piece:any)=>[piece.id,piece]));

 function makeLedger(kind:'company'|'thanwala',source:any){
  const matches=(record:any)=>kind==='company'?record?.company_id===source.id:record?.thanwala_id===source.id;
  const sourceLots=lots.filter((lot:any)=>matches(lot)&&lot.status!=='DRAFT');
  const sourceRecords=uniqueRecords([...labels,...pieces].filter(matches));
  const current=sourceRecords.filter((piece:any)=>!terminalHolders.has(piece.holder)&&!(kind==='company'&&piece.holder==='JOBWORK_COMPANY'));
  const movements=transactions.filter((transaction:any)=>transaction.status!=='DRAFT').map((transaction:any)=>{
   const rows=snapshot(transaction).filter((line:any)=>matches(line)||matches(pieceIndex.get(line.id)));
   if(!rows.length)return null;
   const categories=[...new Set(rows.map((line:any)=>productNames.get(line.product_id)||line.product_name||'Uncategorised'))].join(', ');
   return {...transaction,count:rows.length,rows,categories};
  }).filter(Boolean).sort((a:any,b:any)=>String(b.created_at).localeCompare(String(a.created_at)));
  const categories=new Map<string,any>();
  for(const lot of sourceLots){const id=lot.product_id||'unknown',row=categories.get(id)||{id,name:productNames.get(id)||'Uncategorised',received:0,current:0,inHouse:0,withArtisan:0,disputed:0,pendingLabels:0};row.received+=Number(lot.accepted||0);categories.set(id,row)}
  for(const piece of current){const id=piece.product_id||'unknown',row=categories.get(id)||{id,name:productNames.get(id)||'Uncategorised',received:0,current:0,inHouse:0,withArtisan:0,disputed:0,pendingLabels:0};row.current++;if(piece.holder==='WITH_ARTISAN')row.withArtisan++;if(piece.holder==='IN_HOUSE')row.inHouse++;if(['DAMAGED','DISPUTED','NEEDS_REWORK'].includes(piece.condition))row.disputed++;if(piece.state==='PENDING'||piece.condition==='PENDING_LABEL_CONFIRMATION'||!piece.holder)row.pendingLabels++;categories.set(id,row)}
  const artisanGroups=new Map<string,any>();
  for(const piece of current.filter((item:any)=>item.holder==='WITH_ARTISAN')){const key=`${piece.artisan_id||'unknown'}:${piece.product_id||'unknown'}`,row=artisanGroups.get(key)||{id:key,artisanId:piece.artisan_id,artisan:artisanNames.get(piece.artisan_id)||'Unknown artisan',product:productNames.get(piece.product_id)||'Uncategorised',pieces:0,codes:[]};row.pieces++;row.codes.push(piece.code);artisanGroups.set(key,row)}
  const exactPieces=current.map((piece:any)=>({...piece,product:productNames.get(piece.product_id)||'Uncategorised',artisan:piece.artisan_id?artisanNames.get(piece.artisan_id)||'Unknown artisan':'—',currentHolder:piece.state==='PENDING'||!piece.holder?'Label pending':piece.holder==='WITH_ARTISAN'?artisanNames.get(piece.artisan_id)||'With artisan':piece.holder})).sort((a:any,b:any)=>String(a.code).localeCompare(String(b.code)));
  const received=sourceLots.reduce((sum:number,lot:any)=>sum+Number(lot.accepted||0),0);
  return {
   id:source.id,kind,name:source.name,contact:source.contact||'',address:source.address||'',active:source.active!==0,prefix:source.prefix||'',ownership:source.ownership||'OWN',
   received,current:current.length,stockCheckExpected:sourceRecords.filter((piece:any)=>!outsideWorkshopCheck.has(piece.holder)&&piece.condition!=='PENDING_LABEL_CONFIRMATION'&&piece.state!=='PENDING').length,withArtisan:current.filter((piece:any)=>piece.holder==='WITH_ARTISAN').length,inHouse:current.filter((piece:any)=>piece.holder==='IN_HOUSE').length,pendingLabels:current.filter((piece:any)=>piece.state==='PENDING'||piece.condition==='PENDING_LABEL_CONFIRMATION'||!piece.holder).length,disputedNow:current.filter((piece:any)=>['DAMAGED','DISPUTED','NEEDS_REWORK'].includes(piece.condition)).length,
   freshDespatched:countByType(movements,'JOBWORK_DISPATCH'),disputeReceived:countByType(movements,'JOBWORK_DISPUTE_RETURN'),returnedToSource:countByType(movements,'SUPPLIER_RETURN'),sentToOffice:countByType(movements,'OFFICE_SEND'),soldFromOffice:countByType(movements,'OFFICE_SALE'),intakeDamaged:movements.filter((movement:any)=>movement.type==='INTAKE'&&movement.status==='CONFIRMED').reduce((sum:number,movement:any)=>sum+movement.rows.filter((row:any)=>row.outcome==='DAMAGED').length,0),
   categories:[...categories.values()].sort((a,b)=>b.current-a.current||a.name.localeCompare(b.name)),artisanGroups:[...artisanGroups.values()].sort((a,b)=>b.pieces-a.pieces||a.artisan.localeCompare(b.artisan)),pieces:exactPieces,movements
  };
 }

 const companyLedgers=companies.filter((company:any)=>company.office_only!==1&&company.ownership==='EXTERNAL').map((company:any)=>makeLedger('company',company));
 const thanwalaLedgers=thanwalas.map((thanwala:any)=>makeLedger('thanwala',thanwala));
 return {companies:companyLedgers,thanwalas:thanwalaLedgers,all:[...companyLedgers,...thanwalaLedgers]};
}
