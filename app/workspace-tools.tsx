'use client';
import React,{useMemo,useState} from 'react';
import {ArrowRight,CheckCircle2,Clock,HelpCircle,Package,Hash,Search,TriangleAlert} from 'lucide-react';
import './workspace-tools.css';
import {searchableText} from './language-toggle';

export function CommandCenter({d,pages,can,officeOnly,onNavigate,onNew,onOfficeNew,onScan,onRecovery,onPiece,onLabel}:any){
 const [query,setQuery]=useState('');
 const entries=useMemo(()=>{
  const companies=new Map(d.companies.map((c:any)=>[c.id,c.name])),products=new Map(d.products.map((p:any)=>[p.id,p.name])),lots=new Map(d.lots.map((l:any)=>[l.id,[l.number,l.reference].filter(Boolean).join(' · ')]));
  const actions=[{id:'scan',title:'All-in-one Code Entry',detail:'Enter a tag code to find its next step.',run:onScan},...(can('receipt')?[{id:'new',title:'New Entry',detail:'Create incoming handwritten codes.',run:onNew}]:[]),...(can('officeEntry')?[{id:'office-new',title:'Office New Entry',detail:'Receive products from an outside vendor.',run:onOfficeNew}]:[]),...(can('recovery')?[{id:'recovery',title:'Code Recovery',detail:'Recover a damaged or missing tag code.',run:onRecovery}]:[])].map(item=>({...item,group:'Actions',icon:Hash}));
  const navigation=pages.flatMap((group:any)=>group.items).filter(([name]:any)=>name!=='Data control').map(([name]:any)=>({id:'page-'+name,title:name==='Handoff'?'Out to Artist':name==='Returns'?'Artist Delivery':name,detail:'Open page',group:'Pages',icon:ArrowRight,run:()=>onNavigate(name)}));
  const pieces=[...d.generatedLabels,...d.pieces].map((piece:any)=>({id:'piece-'+piece.id,title:piece.code,detail:[products.get(piece.product_id),companies.get(piece.company_id),lots.get(piece.lot_id),piece.state==='PENDING'?'Pending code':'Code History'].filter(Boolean).join(' · '),group:'Codes',icon:Package,run:()=>piece.state==='PENDING'?onLabel(piece):onPiece(piece)}));
  return [...actions,...navigation,...pieces].map(entry=>({...entry,search:[entry.title,entry.detail,entry.group].map(searchableText).join(' ').toLocaleLowerCase()}));
 },[d,pages,can,officeOnly,onNavigate,onNew,onOfficeNew,onScan,onRecovery,onPiece,onLabel]);
 const normalized=query.trim().toLocaleLowerCase(),matches=normalized?entries.filter(entry=>entry.search.includes(normalized)):entries.filter(entry=>entry.group==='Actions');
 const shown=matches.slice(0,24);
 return <div className="command-center"><label className="command-search"><Search size={20}/><input autoFocus aria-label="Search actions, pages or codes" placeholder="Search actions, pages or codes…" value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&shown.length===1){event.preventDefault();shown[0].run()}}}/>{query&&<button type="button" className="text-btn" onClick={()=>setQuery('')}>Clear</button>}</label><p className="muted">{officeOnly?'Search your office workspace.':'Find a task or search by code, product, company or bill.'}</p><div className="command-results" aria-live="polite"><span className="command-result-count">{normalized?`${matches.length} results`:'Start here'}</span>{shown.map(entry=><button type="button" className="command-result" key={entry.id} onClick={entry.run}><entry.icon size={19}/><span><small>{entry.group}</small><b data-no-translate={entry.group==='Codes'||undefined}>{entry.title}</b><span>{entry.detail}</span></span><ArrowRight size={16}/></button>)}{!shown.length&&<div className="tools-empty"><Search size={24}/><h3>No matching results</h3><p>Try a code, company name or a shorter search.</p><button className="btn" onClick={()=>setQuery('')}>Clear search</button></div>}{matches.length>shown.length&&<p className="muted">Showing the first 24 results. Refine your search to find a specific item.</p>}</div></div>;
}

export function AttentionCenter({d,officeOnly,can,onNavigate,onScan}:any){
 const items=useMemo(()=>{
  if(officeOnly)return [...(can('officeLabel')?[{title:'Office codes to confirm',count:d.generatedLabels.filter((p:any)=>p.journey==='OFFICE').length,detail:'Write each code on its tag before submitting.',view:'Office',filter:'officeLabel'}]:[]),{title:'Workshop deliveries to receive',count:d.pieces.filter((p:any)=>p.holder==='OFFICE_PENDING'&&p.journey!=='OFFICE').length,detail:'Enter product codes after they physically arrive at the office.',view:'Office',filter:'officeReceive'}];
  const now=Date.now(),latest=new Map<string,number>();
  for(const tx of d.transactions){if(!['HANDOFF','ARTIST_TRANSFER','REPRINT_OUT'].includes(tx.type)||tx.status!=='CONFIRMED')continue;try{for(const piece of JSON.parse(tx.snapshot)){const timestamp=Date.parse(tx.created_at);if(timestamp>(latest.get(piece.id)||0))latest.set(piece.id,timestamp)}}catch{}}
  const overdue=d.pieces.filter((p:any)=>p.holder==='WITH_ARTISAN'&&latest.has(p.id)&&now-latest.get(p.id)!>14*86400000).length;
  return [{title:'Codes to confirm',count:d.generatedLabels.length,detail:'Handwritten codes enter stock only after inspection and manual submission.',view:'Label center',filter:'intake'},{title:'Artist work over two weeks',count:overdue,detail:'Review the artisan balance and follow up on delivery.',view:'Artisans',filter:'ALL'},{title:'Damage or rework to review',count:d.pieces.filter((p:any)=>['IN_HOUSE','GROUND_STAFF','WITH_ARTISAN'].includes(p.holder)&&['DAMAGED','DISPUTED','NEEDS_REWORK'].includes(p.condition)).length,detail:'Enter a saree code to see its valid return, reprint or finishing step.',scan:true},{title:'Open exceptions',count:d.exceptions.filter((e:any)=>e.status==='OPEN').length,detail:'Review discrepancies and their supporting records.',view:'Exceptions',filter:'ALL'}];
 },[d,officeOnly,can]);
 const active=items.filter(item=>item.count>0);
 return <div className="attention-center"><p className="muted">{officeOnly?'Pending work within your office access.':'Follow up on these pending tasks.'}</p>{active.length?active.map(item=><button key={item.title} className="attention-task" onClick={()=>item.scan?onScan():onNavigate(item.view,item.filter)}><span className="attention-task-count">{item.count}</span><span><b>{item.title}</b><small>{item.detail}</small></span><ArrowRight size={17}/></button>):<div className="tools-empty"><CheckCircle2 size={30}/><h3>You are all caught up</h3><p>No pending tasks in this summary.</p></div>}<small className="muted">Counts reflect the latest loaded inventory.</small></div>;
}

export function MovementConfirmation({option,item,d,busy,onConfirm,onCancel}:any){
 const [confirmed,setConfirmed]=useState(false);
 const destinations:Record<string,string>={officeSend:'In office inventory processing',officeReceive:'Office inventory submitted',officeLabel:'Office inventory submitted',officeSell:'Sold out',jobworkDispatch:item.company_name||'Jobwork company'};
 return <div className="movement-confirmation"><div className="confirmation-symbol"><Hash size={26}/></div><h3>{option.title}</h3><p>{option.detail}</p><dl><div><dt>Piece Code</dt><dd className="mono" data-no-translate>{item.code}</dd></div><div><dt>Product</dt><dd>{d.products.find((p:any)=>p.id===item.product_id)?.name||'Product'}</dd></div><div><dt>Next stage</dt><dd>{destinations[option.directOp]}</dd></div></dl><label className="checkbox"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>I checked the physical product and confirm this movement.</label><p className="secure-note">The movement will be saved with your name, date and time.</p><div className="modal-footer"><button className="btn" disabled={busy} onClick={onCancel}>Back to actions</button><button className="btn primary" disabled={!confirmed||busy} onClick={onConfirm}>{busy?'Saving…':'Confirm & save'}</button></div></div>;
}

export function WorkspaceGuide({officeOnly,onScan}:any){
 const steps=officeOnly?[
  ['Receive office products','Workshop products: use Factory Finished Goods Received after Send to Office. Outside-vendor products: create Office New Entry, write each supplied code on a tag, then confirm it.'],
  ['Enter a code for the next step','Use All-in-one Code Entry to receive, sell or return an eligible product. Check the handwritten code and confirm before saving.'],
  ['Find stock and its history','Office Inventory shows products currently in the office. Open Details to see the code journey. Sold items stay in Sold Out Products.'],
  ['Handle returns','Workshop-origin disputes can be sent back to the factory. Factory Staff must enter their codes on arrival.']
 ]:[
  ['Prepare handwritten codes','Create a New Entry, choose Jobwork or TaraFabbs Own Product, then write each generated code on its product tag. Bill number is optional.'],
  ['Inspect and enter into stock','Enter each handwritten code and check its condition. Unconfirmed codes stay pending; damaged arrivals go through Damage products.'],
  ['Track every artist','Use Out to Artist and Artist Delivery for each round of work. The same saree can go through multiple artists, with every round in its history.'],
  ['Finish and despatch','Send to Ground Staff, then receive finished goods. Despatch jobwork to its company or send TaraFabbs stock to the office.'],
  ['Recover a damaged label','Use Code Recovery, match the physical saree and write the same permanent code on a new tag. A replacement tag does not move stock.']
 ];
 return <div className="workspace-guide"><p>Start with the All-in-one Code Entry when you are unsure of the next step.</p><button className="btn primary" onClick={onScan}><Hash size={17}/>Enter a code</button><ol>{steps.map(([title,detail])=><li key={title}><h3>{title}</h3><p>{detail}</p></li>)}</ol><div className="info-strip"><HelpCircle size={18}/>Read the four-character code written on the tag, type it into the code field and press Submit.</div><div className="guide-reminder"><Clock size={16}/><p>Your access determines which actions appear. Every confirmed movement keeps its history.</p></div></div>;
}
