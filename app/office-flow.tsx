'use client';
import React,{useEffect,useId,useMemo,useState} from 'react';
import {ArrowUpRight,CheckCircle2,ChevronLeft,ChevronRight,Search,Truck,X} from 'lucide-react';
import ScannerInput from './scanner-input';
import './workflow.css';
import './office-usability.css';

const modeInfo:Record<string,{title:string;description:string;permission:string;holder:string;audience:'factory'|'office'}>={
 jobworkReturn:{title:'Return from Company for Dispute',description:'Scan a finished item that was dispatched to its original jobwork company.',permission:'postFinish',holder:'JOBWORK_COMPANY',audience:'factory'},
 factoryReceive:{title:'Receive Return at Factory',description:'Factory Staff scans an office or customer dispute after it physically reaches the workshop.',permission:'postFinish',holder:'FACTORY_RETURN_PENDING',audience:'factory'},
 officeLabel:{title:'Confirm New Office Label',description:'Scan a barcode created by Office New Entry after attaching it to the outside-vendor product.',permission:'officeLabel',holder:'OFFICE_PENDING',audience:'office'},
 officeReceive:{title:'Factory Finished Goods Received',description:'Office Staff scans a TaraFabbs item sent from the factory and submits it into office inventory.',permission:'officeReceive',holder:'OFFICE_PENDING',audience:'office'},
 officeSell:{title:'Sold Out',description:'Office Staff scans a confirmed office-stock barcode to mark it sold.',permission:'officeSell',holder:'OFFICE_STOCK',audience:'office'},
 officeReturn:{title:'Dispute Return to Workshop',description:'Office Staff sends a disputed unsold office item back for Factory Staff receipt.',permission:'officeReturn',holder:'OFFICE_STOCK',audience:'office'},
 customerReturn:{title:'Dispute Return from Customer',description:'Scan a sold product returned by the customer and send it back for Factory Staff receipt.',permission:'officeReturn',holder:'SOLD',audience:'office'},
};

function Scanner({mode,d,action,busy,can,openPiece,initialCode='',onInitialCodeUsed}:any){
 const info=modeInfo[mode];
 const pieces=[...d.pieces,...d.generatedLabels.filter((p:any)=>p.journey==='OFFICE')];
 const [pending,setPending]=useState<any>(null),[confirmed,setConfirmed]=useState(false),[reason,setReason]=useState(''),[message,setMessage]=useState(''),[bad,setBad]=useState(false),[key,setKey]=useState(()=>crypto.randomUUID());
 const disputed=['jobworkReturn','officeReturn','customerReturn'].includes(mode),factoryReceive=mode==='factoryReceive';
 const showHistory=(code:string)=>{const piece=pieces.find((p:any)=>p.code===code);if(!piece)return false;openPiece(piece);return true};
 function scan(code:string,source:string){
  const p=pieces.find((piece:any)=>piece.code===code.trim().toUpperCase());
  if(!p){setMessage('No registered product in this panel matches that barcode.');setBad(true);return}
  if(p.holder!==info.holder){setMessage(`${p.code} is not currently eligible for ${info.title}.`);setBad(true);return}
  if(mode==='officeLabel'&&(p.journey!=='OFFICE'||p.condition!=='PENDING_LABEL_CONFIRMATION')){setMessage(`${p.code} is not a pending outside-vendor office label.`);setBad(true);return}
  if(mode==='officeReceive'&&(p.journey==='OFFICE'||p.condition!=='FINISHED')){setMessage(`${p.code} did not come from the TaraFabbs workshop. Use Confirm New Office Label for an outside-vendor entry.`);setBad(true);return}
  setPending({...p,source});setConfirmed(false);setReason('');setMessage('');setBad(false);
 }
 useEffect(()=>{if(!initialCode||pending)return;onInitialCodeUsed?.();scan(initialCode,'all-in-one')},[initialCode,pending]);
 async function save(){
  if(!pending)return;
  const result=await action(mode,{id:pending.id,version:pending.version,disputed:disputed?confirmed:undefined,received:factoryReceive?confirmed:undefined,reason:disputed?reason.trim():undefined},undefined,key);
  if(result){const code=pending.code;setPending(null);setConfirmed(false);setReason('');setKey(crypto.randomUUID());setMessage(`${code} recorded. Its location, inventory status and barcode history are updated.`);setBad(false)}
 }
 const buttonLabel=mode==='jobworkReturn'?'Receive disputed company return':mode==='factoryReceive'?'Receive into factory inventory':mode==='officeLabel'?'Confirm label & add to office inventory':mode==='officeReceive'?'Submit to office inventory':mode==='officeSell'?'Mark Sold Out':mode==='officeReturn'?'Send dispute to workshop':'Send customer return to workshop';
 return <section className="panel scan-station"><div className="panel-heading"><div><h2>{info.title}</h2><p>{info.description}</p></div></div><div className="station-body"><ScannerInput onScan={scan} onHistory={showHistory} historyDisabled={busy} disabled={busy||!!pending||!can(info.permission)}/>{message&&<div className={bad?'form-error':'info-strip'} role="status">{message}</div>}{pending&&<div className="inspection-card"><h3 className="mono">{pending.code}</h3><p>{d.products.find((p:any)=>p.id===pending.product_id)?.name} · {d.companies.find((c:any)=>c.id===pending.company_id)?.name}</p>{(disputed||factoryReceive)&&<label className="checkbox disputed-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{factoryReceive?'Physical product received and dispute identity checked at factory':mode==='jobworkReturn'?'Disputed product physically returned from the original company':mode==='officeReturn'?'Office dispute checked and ready to return to workshop':'Customer dispute checked and ready to return to workshop'}</label>}{disputed&&<label className="field"><span>Dispute / return reason</span><textarea autoFocus rows={3} required value={reason} onChange={e=>setReason(e.target.value)} placeholder="Why is this product being returned?"/></label>}{!disputed&&!factoryReceive&&<div className="info-strip"><CheckCircle2 size={17}/>Confirm only after the physical barcode and product have been checked.</div>}<div className="button-row"><button className={'btn primary '+(disputed?'danger-button':'')} disabled={busy||(disputed||factoryReceive)&&!confirmed||disputed&&!reason.trim()} onClick={save}>{busy?'Saving…':buttonLabel}</button><button className="btn" disabled={busy} onClick={()=>setPending(null)}>Cancel scan</button></div></div>}<p className="secure-note">Every scan writes a dated movement. Invalid stages and duplicate confirmations are blocked.</p></div></section>;
}

function PagedTable({title,rows,headers,renderRow,searchText,empty}:any){
 const [query,setQuery]=useState(''),[page,setPage]=useState(0),searchId=useId(),pageSize=12;
 const filtered=useMemo(()=>{const q=query.trim().toLocaleLowerCase();return q?rows.filter((row:any)=>searchText(row).toLocaleLowerCase().includes(q)):rows},[rows,query,searchText]);
 useEffect(()=>setPage(0),[query,rows.length]);
 const pages=Math.max(1,Math.ceil(filtered.length/pageSize)),current=Math.min(page,pages-1),start=current*pageSize;
 return <><div className="office-table-search"><label htmlFor={searchId}><Search size={16}/><input id={searchId} type="search" value={query} onChange={e=>setQuery(e.target.value)} aria-label={`Search ${title}`} placeholder="Search barcode, product or source…"/>{query&&<button className="icon-btn" aria-label="Clear search" onClick={()=>setQuery('')}><X size={16}/></button>}</label></div><div className="table-scroll"><table aria-label={title}><thead><tr>{headers.map((header:string)=><th key={header} scope="col">{header}</th>)}</tr></thead><tbody>{filtered.slice(start,start+pageSize).map(renderRow)}</tbody></table>{!filtered.length&&<div className="office-table-empty" role="status"><p>{query?'No matching records':empty}</p>{query&&<button className="text-btn" onClick={()=>setQuery('')}>Clear search</button>}</div>}</div><div className="office-table-pages" aria-label={`${title} pages`}><span aria-live="polite">{filtered.length?`${start+1}–${Math.min(start+pageSize,filtered.length)} / ${filtered.length}`:'0'} records</span><div><button className="icon-btn" aria-label={`Previous page of ${title}`} disabled={current===0} onClick={()=>setPage(current-1)}><ChevronLeft size={18}/></button><span>{current+1} / {pages}</span><button className="icon-btn" aria-label={`Next page of ${title}`} disabled={current>=pages-1} onClick={()=>setPage(current+1)}><ChevronRight size={18}/></button></div></div></>;
}

export default function DispatchOfficeFlow({audience='factory',d,action,busy,can,openPiece,initialMode='ALL',initialCode='',onInitialCodeUsed}:any){
 const modes=Object.entries(modeInfo).filter(([,info])=>info.audience===audience&&can(info.permission));
 const first=modes.some(([id])=>id===initialMode)?initialMode:modes[0]?.[0]||'';
 const [mode,setMode]=useState(first);
 const {history,movementIndex}=useMemo(()=>{
  const types=new Set(audience==='office'?['OFFICE_VENDOR_INTAKE','OFFICE_LABEL_CONFIRM','OFFICE_SEND','OFFICE_RECEIVE','OFFICE_SALE','OFFICE_DISPUTE_RETURN','CUSTOMER_DISPUTE_RETURN']:['JOBWORK_DISPATCH','JOBWORK_DISPUTE_RETURN','OFFICE_DISPUTE_RETURN','CUSTOMER_DISPUTE_RETURN','FACTORY_DISPUTE_RECEIVE']);
  const index=new Map<string,Map<string,any>>();
  const rows=d.transactions.filter((t:any)=>types.has(t.type)).map((transaction:any)=>{
   let lines:any[]=[];try{const parsed=JSON.parse(transaction.snapshot);if(Array.isArray(parsed))lines=parsed}catch{}
   for(const line of lines){if(!line?.id)continue;let byType=index.get(line.id);if(!byType){byType=new Map();index.set(line.id,byType)}if(!byType.has(transaction.type))byType.set(transaction.type,transaction)}
   return {transaction,row:lines[0]||{}};
  });
  return {history:rows,movementIndex:index};
 },[d.transactions,audience]);
 const date=(s:string)=>new Date(s).toLocaleString('en-IN',{timeZone:d.settings.timezone||'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
 const lastMovement=(piece:any,type:string|string[])=>{const byType=movementIndex.get(piece.id);if(!byType)return undefined;return (Array.isArray(type)?type:[type]).map(t=>byType.get(t)).filter(Boolean).sort((a:any,b:any)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0]};
 const dispatches=d.pieces.filter((p:any)=>p.holder==='JOBWORK_COMPANY');
 const returnPending=d.pieces.filter((p:any)=>p.holder==='FACTORY_RETURN_PENDING');
 const officePieces=[...d.pieces,...d.generatedLabels.filter((p:any)=>p.journey==='OFFICE')];
 const officeProcessing=officePieces.filter((p:any)=>['OFFICE_PENDING','OFFICE_STOCK'].includes(p.holder));
 const sold=d.pieces.filter((p:any)=>p.holder==='SOLD');
 const companyReturns=d.pieces.filter((p:any)=>movementIndex.get(p.id)?.has('JOBWORK_DISPUTE_RETURN')&&p.holder==='IN_HOUSE'&&p.condition==='DISPUTED');
 const pieceIndex=useMemo(()=>new Map([...d.pieces,...d.generatedLabels.filter((p:any)=>p.journey==='OFFICE')].map((p:any)=>[p.id,p])),[d.pieces,d.generatedLabels]);
 const product=(p:any)=>d.products.find((x:any)=>x.id===p.product_id)?.name||'Product';
 const company=(p:any)=>d.companies.find((x:any)=>x.id===p.company_id)?.name||'Source';
 const stage=(p:any)=>p.condition==='PENDING_LABEL_CONFIRMATION'?'Awaiting attached-label scan':p.holder==='OFFICE_PENDING'?'In office inventory processing':p.holder==='OFFICE_STOCK'?'Office inventory submitted':p.holder==='SOLD'?'Sold out':'Return to workshop · factory receipt pending';
 const table=(title:string,description:string,rows:any[],movementType:string|string[],stageColumn=false)=><section className="panel margin-top"><div className="panel-heading"><div><h2>{title}</h2><p>{description}</p></div></div><PagedTable title={title} rows={rows} headers={['Barcode','Product',stageColumn?'Stage':'Original source','Date & time','History']} empty="No items in this stage." searchText={(p:any)=>[p.code,product(p),company(p),stage(p)].join(' ')} renderRow={(p:any)=>{const tx=lastMovement(p,movementType);return <tr key={p.id}><td className="mono">{p.code}</td><td>{product(p)}</td><td>{stageColumn?stage(p):company(p)}</td><td>{tx?date(tx.created_at):'—'}</td><td><button className="text-btn" aria-label={`View history for ${p.code}`} onClick={()=>openPiece(p)}>Details<ArrowUpRight size={14}/></button></td></tr>}}/></section>;
 return <>{modes.length>0&&<div className="tabs office-tabs">{modes.map(([id,info])=><button key={id} className={mode===id?'selected':''} onClick={()=>setMode(id)}>{info.title}</button>)}</div>}{mode&&<Scanner key={mode} mode={mode} d={d} action={action} busy={busy} can={can} openPiece={openPiece} initialCode={initialCode} onInitialCodeUsed={onInitialCodeUsed}/>} {audience==='factory'?<>{table('Despatched Items','Finished jobwork products outside inventory, with their exact company and dispatch time.',dispatches,'JOBWORK_DISPATCH')}{table('Return to Workshop · Awaiting Factory Scan','Office or customer disputes stay outside factory inventory until Factory Staff scans them.',returnPending,['OFFICE_DISPUTE_RETURN','CUSTOMER_DISPUTE_RETURN'],true)}{table('Dispute Return from Company','Company disputes currently received into factory inventory and ready for reprint or Ground Staff.',companyReturns,'JOBWORK_DISPUTE_RETURN',true)}</>:<>{table('Office Inventory','Only products currently in the office are shown: workshop receipts and outside-vendor office entries.',officeProcessing,['OFFICE_VENDOR_INTAKE','OFFICE_LABEL_CONFIRM','OFFICE_RECEIVE','OFFICE_SEND'],true)}{table('Sold Out Products','Sold products remain outside active inventory with their sale date and permanent barcode history.',sold,'OFFICE_SALE',true)}{table('Returns Sent to Workshop','Only TaraFabbs workshop-origin disputes can move back to the factory.',returnPending,['OFFICE_DISPUTE_RETURN','CUSTOMER_DISPUTE_RETURN'],true)}</>}<section className="panel margin-top"><div className="panel-heading"><div><h2>{audience==='office'?'Office Journey History':'Dispatch & Factory Return History'}</h2><p>Every office entry, attached-label scan, receipt, sale and eligible return keeps its barcode, operator, date and time.</p></div><Truck size={19}/></div><PagedTable title={audience==='office'?'Office Journey History':'Dispatch & Factory Return History'} rows={history} headers={['Date & time','Movement','Barcode','Details','History']} empty="Movement history will appear after the first office entry or scan." searchText={({transaction:t,row}:any)=>[row.code,t.type.replaceAll('_',' '),t.reason,t.number].join(' ')} renderRow={({transaction:t,row}:any)=>{const piece=pieceIndex.get(row.id);return <tr key={t.id}><td>{date(t.created_at)}</td><td>{t.type.toLowerCase().replaceAll('_',' ')}</td><td className="mono">{row.code||'—'}</td><td>{t.reason}</td><td>{piece&&<button className="text-btn" aria-label={`View history for ${row.code}`} onClick={()=>openPiece(piece)}>Details<ArrowUpRight size={14}/></button>}</td></tr>}}/></section></>;
}
