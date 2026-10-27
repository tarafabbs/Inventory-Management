'use client';
import React,{useEffect,useState} from 'react';
import {ArrowUpRight,CheckCircle2,Truck} from 'lucide-react';
import ScannerInput from './scanner-input';
import './workflow.css';

const modeInfo:Record<string,{title:string;description:string;permission:string;holder:string;audience:'factory'|'office'}>={
 jobworkReturn:{title:'Return from Company for Dispute',description:'Scan a finished item that was dispatched to its original jobwork company.',permission:'postFinish',holder:'JOBWORK_COMPANY',audience:'factory'},
 factoryReceive:{title:'Receive Return at Factory',description:'Factory Staff scans an office or customer dispute after it physically reaches the workshop.',permission:'postFinish',holder:'FACTORY_RETURN_PENDING',audience:'factory'},
 officeReceive:{title:'Factory Finished Goods Received',description:'Office Staff scans a TaraFabbs item sent from the factory and submits it into office inventory.',permission:'officeReceive',holder:'OFFICE_PENDING',audience:'office'},
 officeSell:{title:'Sold Out',description:'Office Staff scans a confirmed office-stock barcode to mark it sold.',permission:'officeSell',holder:'OFFICE_STOCK',audience:'office'},
 officeReturn:{title:'Dispute Return to Workshop',description:'Office Staff sends a disputed unsold office item back for Factory Staff receipt.',permission:'officeReturn',holder:'OFFICE_STOCK',audience:'office'},
 customerReturn:{title:'Dispute Return from Customer',description:'Scan a sold product returned by the customer and send it back for Factory Staff receipt.',permission:'officeReturn',holder:'SOLD',audience:'office'},
};

function Scanner({mode,d,action,busy,can,openPiece,initialCode='',onInitialCodeUsed}:any){
 const info=modeInfo[mode];
 const [pending,setPending]=useState<any>(null),[confirmed,setConfirmed]=useState(false),[reason,setReason]=useState(''),[message,setMessage]=useState(''),[bad,setBad]=useState(false),[key,setKey]=useState(()=>crypto.randomUUID());
 const disputed=['jobworkReturn','officeReturn','customerReturn'].includes(mode),factoryReceive=mode==='factoryReceive';
 const showHistory=(code:string)=>{const piece=d.pieces.find((p:any)=>p.code===code);if(!piece)return false;openPiece(piece);return true};
 function scan(code:string,source:string){
  const p=d.pieces.find((piece:any)=>piece.code===code.trim().toUpperCase());
  if(!p){setMessage('No registered product in this panel matches that barcode.');setBad(true);return}
  if(p.holder!==info.holder){setMessage(`${p.code} is not currently eligible for ${info.title}.`);setBad(true);return}
  setPending({...p,source});setConfirmed(false);setReason('');setMessage('');setBad(false);
 }
 useEffect(()=>{if(!initialCode||pending)return;onInitialCodeUsed?.();scan(initialCode,'all-in-one')},[initialCode,pending]);
 async function save(){
  if(!pending)return;
  const result=await action(mode,{id:pending.id,version:pending.version,disputed:disputed?confirmed:undefined,received:factoryReceive?confirmed:undefined,reason:disputed?reason.trim():undefined},undefined,key);
  if(result){const code=pending.code;setPending(null);setConfirmed(false);setReason('');setKey(crypto.randomUUID());setMessage(`${code} recorded. Its location, inventory status and barcode history are updated.`);setBad(false)}
 }
 const buttonLabel=mode==='jobworkReturn'?'Receive disputed company return':mode==='factoryReceive'?'Receive into factory inventory':mode==='officeReceive'?'Submit to office inventory':mode==='officeSell'?'Mark Sold Out':mode==='officeReturn'?'Send dispute to workshop':'Send customer return to workshop';
 return <section className="panel scan-station"><div className="panel-heading"><div><h2>{info.title}</h2><p>{info.description}</p></div></div><div className="station-body"><ScannerInput onScan={scan} onHistory={showHistory} historyDisabled={busy} disabled={busy||!!pending||!can(info.permission)}/>{message&&<div className={bad?'form-error':'info-strip'} role="status">{message}</div>}{pending&&<div className="inspection-card"><h3 className="mono">{pending.code}</h3><p>{d.products.find((p:any)=>p.id===pending.product_id)?.name} · {d.companies.find((c:any)=>c.id===pending.company_id)?.name}</p>{(disputed||factoryReceive)&&<label className="checkbox disputed-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{factoryReceive?'Physical product received and dispute identity checked at factory':mode==='jobworkReturn'?'Disputed product physically returned from the original company':mode==='officeReturn'?'Office dispute checked and ready to return to workshop':'Customer dispute checked and ready to return to workshop'}</label>}{disputed&&<label className="field"><span>Dispute / return reason</span><textarea autoFocus rows={3} required value={reason} onChange={e=>setReason(e.target.value)} placeholder="Why is this product being returned?"/></label>}{!disputed&&!factoryReceive&&<div className="info-strip"><CheckCircle2 size={17}/>Confirm only after the physical barcode and product have been checked.</div>}<div className="button-row"><button className={'btn primary '+(disputed?'danger-button':'')} disabled={busy||(disputed||factoryReceive)&&!confirmed||disputed&&!reason.trim()} onClick={save}>{busy?'Saving…':buttonLabel}</button><button className="btn" disabled={busy} onClick={()=>setPending(null)}>Cancel scan</button></div></div>}<p className="secure-note">Every scan writes a dated movement. Invalid stages and duplicate confirmations are blocked.</p></div></section>;
}

function piecesInTransaction(tx:any,pieceId:string){try{return JSON.parse(tx.snapshot).some((p:any)=>p.id===pieceId)}catch{return false}}

export default function DispatchOfficeFlow({audience='factory',d,action,busy,can,openPiece,initialMode='ALL',initialCode='',onInitialCodeUsed}:any){
 const modes=Object.entries(modeInfo).filter(([,info])=>info.audience===audience&&can(info.permission));
 const first=modes.some(([id])=>id===initialMode)?initialMode:modes[0]?.[0]||'';
 const [mode,setMode]=useState(first);
 const movementTypes=['JOBWORK_DISPATCH','JOBWORK_DISPUTE_RETURN','OFFICE_SEND','OFFICE_RECEIVE','OFFICE_SALE','OFFICE_DISPUTE_RETURN','CUSTOMER_DISPUTE_RETURN','FACTORY_DISPUTE_RECEIVE'];
 const history=d.transactions.filter((t:any)=>movementTypes.includes(t.type));
 const date=(s:string)=>new Date(s).toLocaleString('en-IN',{timeZone:d.settings.timezone||'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
 const lastMovement=(piece:any,type:string|string[])=>history.find((t:any)=>(Array.isArray(type)?type.includes(t.type):t.type===type)&&piecesInTransaction(t,piece.id));
 const dispatches=d.pieces.filter((p:any)=>p.holder==='JOBWORK_COMPANY');
 const returnPending=d.pieces.filter((p:any)=>p.holder==='FACTORY_RETURN_PENDING');
 const officeProcessing=d.pieces.filter((p:any)=>['OFFICE_PENDING','OFFICE_STOCK'].includes(p.holder));
 const sold=d.pieces.filter((p:any)=>p.holder==='SOLD');
 const companyReturnIds=new Set(history.filter((t:any)=>t.type==='JOBWORK_DISPUTE_RETURN').flatMap((t:any)=>{try{return JSON.parse(t.snapshot).map((p:any)=>p.id)}catch{return []}}));
 const companyReturns=d.pieces.filter((p:any)=>companyReturnIds.has(p.id)&&p.holder==='IN_HOUSE'&&p.condition==='DISPUTED');
 const product=(p:any)=>d.products.find((x:any)=>x.id===p.product_id)?.name||'Product';
 const company=(p:any)=>d.companies.find((x:any)=>x.id===p.company_id)?.name||'Source';
 const stage=(p:any)=>p.holder==='OFFICE_PENDING'?'In office inventory processing':p.holder==='OFFICE_STOCK'?'Office inventory submitted':p.holder==='SOLD'?'Sold out':'Return to workshop · factory receipt pending';
 const table=(title:string,description:string,rows:any[],movementType:string|string[],stageColumn=false)=><section className="panel margin-top"><div className="panel-heading"><div><h2>{title}</h2><p>{description}</p></div></div><div className="table-scroll"><table><thead><tr><th>Barcode</th><th>Product</th><th>{stageColumn?'Stage':'Original source'}</th><th>Date & time</th><th>History</th></tr></thead><tbody>{rows.map((p:any)=>{const tx=lastMovement(p,movementType);return <tr key={p.id}><td className="mono">{p.code}</td><td>{product(p)}</td><td>{stageColumn?stage(p):company(p)}</td><td>{tx?date(tx.created_at):'—'}</td><td><button className="text-btn" onClick={()=>openPiece(p)}>Details<ArrowUpRight size={14}/></button></td></tr>})}</tbody></table>{!rows.length&&<p className="empty">No items in this stage.</p>}</div></section>;
 return <>{modes.length>0&&<div className="tabs office-tabs">{modes.map(([id,info])=><button key={id} className={mode===id?'selected':''} onClick={()=>setMode(id)}>{info.title}</button>)}</div>}{mode&&<Scanner key={mode} mode={mode} d={d} action={action} busy={busy} can={can} openPiece={openPiece} initialCode={initialCode} onInitialCodeUsed={onInitialCodeUsed}/>} {audience==='factory'?<>{table('Despatched Items','Finished jobwork products outside inventory, with their exact company and dispatch time.',dispatches,'JOBWORK_DISPATCH')}{table('Return to Workshop · Awaiting Factory Scan','Office or customer disputes stay outside factory inventory until Factory Staff scans them.',returnPending,['OFFICE_DISPUTE_RETURN','CUSTOMER_DISPUTE_RETURN'],true)}{table('Dispute Return from Company','Company disputes currently received into factory inventory and ready for reprint or Ground Staff.',companyReturns,'JOBWORK_DISPUTE_RETURN',true)}</>:<>{table('Office Inventory','Factory-finished products being processed or already submitted into office stock.',officeProcessing,['OFFICE_RECEIVE','OFFICE_SEND'],true)}{table('Sold Out Products','Sold products remain outside active inventory with their sale date and permanent barcode history.',sold,'OFFICE_SALE',true)}{table('Returns Sent to Workshop','Office/customer disputes waiting for the separate Factory Staff receipt scan.',returnPending,['OFFICE_DISPUTE_RETURN','CUSTOMER_DISPUTE_RETURN'],true)}</>}<section className="panel margin-top"><div className="panel-heading"><div><h2>{audience==='office'?'Office Movement History':'Dispatch & Factory Return History'}</h2><p>Every step keeps the barcode, operator, date, time and reason.</p></div><Truck size={19}/></div><div className="table-scroll"><table><thead><tr><th>Date & time</th><th>Movement</th><th>Barcode</th><th>Details</th><th>History</th></tr></thead><tbody>{history.map((t:any)=>{let row:any={};try{row=JSON.parse(t.snapshot)[0]||{}}catch{}const piece=d.pieces.find((p:any)=>p.id===row.id);return <tr key={t.id}><td>{date(t.created_at)}</td><td>{t.type.toLowerCase().replaceAll('_',' ')}</td><td className="mono">{row.code||'—'}</td><td>{t.reason}</td><td>{piece&&<button className="text-btn" onClick={()=>openPiece(piece)}>Details<ArrowUpRight size={14}/></button>}</td></tr>})}</tbody></table>{!history.length&&<p className="empty">Movement history will appear after the first scan.</p>}</div></section></>;
}
