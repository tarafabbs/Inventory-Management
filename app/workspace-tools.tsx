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

export function attentionItems(d:any,officeOnly:boolean,can:(permission:string)=>boolean){
 if(officeOnly){const legacy=d.generatedLabels.filter((p:any)=>p.journey==='OFFICE'),deliveries=d.pieces.filter((p:any)=>p.holder==='OFFICE_PENDING'&&p.journey!=='OFFICE');return [...(can('officeLabel')?[{title:'Legacy office codes to confirm',count:legacy.length,pieces:legacy,detail:'Older pending codes still need submission.',view:'Office',filter:'officeLabel'}]:[]),{title:'Workshop deliveries to receive',count:deliveries.length,pieces:deliveries,detail:'Submit codes after the products physically arrive.',view:'Office',filter:'officeReceive'}]}
 const now=Date.now(),latest=new Map<string,number>();
 for(const piece of d.pieces)latest.set(piece.id,Date.parse(piece.created_at)||now);
 for(const tx of d.transactions){if(tx.status!=='CONFIRMED')continue;try{for(const piece of JSON.parse(tx.snapshot||'[]')){if(!piece?.id)continue;const timestamp=Date.parse(tx.created_at);if(timestamp>(latest.get(piece.id)||0))latest.set(piece.id,timestamp)}}catch{}}
 const artistOverdue=d.pieces.filter((p:any)=>p.holder==='WITH_ARTISAN'&&now-(latest.get(p.id)||now)>14*86400000);
 const warehouseOverdue=d.pieces.filter((p:any)=>['IN_HOUSE','GROUND_STAFF'].includes(p.holder)&&now-(latest.get(p.id)||now)>30*86400000);
 const damaged=d.pieces.filter((p:any)=>['IN_HOUSE','GROUND_STAFF','WITH_ARTISAN'].includes(p.holder)&&['DAMAGED','DISPUTED','NEEDS_REWORK'].includes(p.condition));
 return [{title:'Legacy pending codes',count:d.generatedLabels.length,pieces:d.generatedLabels,detail:'Older pending records need attention; new entries now go directly to stock.',view:'Label center',filter:'intake'},{title:'Artist work over 14 days',count:artistOverdue.length,pieces:artistOverdue,detail:'Follow up on sarees held by an artist for more than two weeks.',view:'Artisans',filter:'ALL'},{title:'Warehouse stock over 30 days',count:warehouseOverdue.length,pieces:warehouseOverdue,detail:'Review sarees with no recorded movement for 30 days.',view:'Inventory',filter:'ALL'},{title:'Damage, dispute or rework',count:damaged.length,pieces:damaged,detail:'These exact codes require a return, reprint or resolution.',scan:true},{title:'Open entry errors / exceptions',count:d.exceptions.filter((e:any)=>e.status==='OPEN').length,detail:'Review discrepancies and their supporting records.',view:'Exceptions',filter:'ALL'}];
}

export function attentionCount(d:any,officeOnly:boolean,can:(permission:string)=>boolean){return attentionItems(d,officeOnly,can).reduce((sum:number,item:any)=>sum+item.count,0)}

export function AttentionCenter({d,officeOnly,can,onNavigate,onScan,onPiece}:any){
 const items=useMemo(()=>attentionItems(d,officeOnly,can),[d,officeOnly,can]);
 const active=items.filter(item=>item.count>0);
 return <div className="attention-center"><p className="muted">{officeOnly?'Pending work within your office access.':'Rules: artist 14 days · warehouse 30 days · errors and damaged stock immediately.'}</p>{active.length?active.map((item:any)=><article className="attention-task-group" key={item.title}><button className="attention-task" onClick={()=>item.scan?onScan():onNavigate(item.view,item.filter)}><span className="attention-task-count">{item.count}</span><span><b>{item.title}</b><small>{item.detail}</small></span><ArrowRight size={17}/></button>{item.pieces?.length>0&&<div className="attention-codes" aria-label={`${item.title} codes`}>{item.pieces.slice(0,12).map((piece:any)=><button type="button" className="mono" key={piece.id} onClick={()=>onPiece?.(piece)}>{piece.code}</button>)}{item.pieces.length>12&&<span>+{item.pieces.length-12} more</span>}</div>}</article>):<div className="tools-empty"><CheckCircle2 size={30}/><h3>You are all caught up</h3><p>No pending tasks in this summary.</p></div>}<small className="muted">Counts reflect the latest loaded inventory.</small></div>;
}

export function MovementConfirmation({option,item,d,busy,onConfirm,onCancel}:any){
 const destinations:Record<string,string>={officeSend:'In office inventory processing',officeReceive:'Office inventory submitted',officeLabel:'Office inventory submitted',officeSell:'Sold out',jobworkDispatch:item.company_name||'Jobwork company'};
 return <div className="movement-confirmation"><div className="confirmation-symbol"><Hash size={26}/></div><h3>{option.title}</h3><p>{option.detail}</p><dl><div><dt>Piece Code</dt><dd className="mono" data-no-translate>{item.code}</dd></div><div><dt>Product</dt><dd>{d.products.find((p:any)=>p.id===item.product_id)?.name||'Product'}</dd></div><div><dt>Next stage</dt><dd>{destinations[option.directOp]}</dd></div></dl><p className="secure-note">Submit completes this movement and saves your name, date and time. No extra OK checkbox is required.</p><div className="modal-footer"><button className="btn" disabled={busy} onClick={onCancel}>Back to actions</button><button className="btn primary" disabled={busy} onClick={onConfirm}>{busy?'Saving…':'Submit movement'}</button></div></div>;
}

export function WorkspaceGuide({officeOnly,onScan}:any){
 const steps=officeOnly?[
  ['Receive office products','Workshop products: use Factory Finished Goods Received after Send to Office. Outside-vendor Office New Entry goes directly to Office Inventory.'],
  ['Enter a code for the next step','Use All-in-one Code Entry to receive, sell or return an eligible product. Normal code submission completes the selected action.'],
  ['Find stock and its history','Office Inventory shows products currently in the office. Open Details to see the code journey. Sold items stay in Sold Out Products.'],
  ['Handle returns','Workshop-origin disputes can be sent back to the factory. Factory Staff must enter their codes on arrival.']
 ]:[
  ['Create stock and handwritten codes','New Entry creates the codes and puts every piece directly in stock. Write each 1–4 character code on its matching tag. Bill number is optional.'],
  ['Submit normal movements once','Choose the action and submit the tag code. No OK / Good checkbox or second stock-in step is required.'],
  ['Track every artist','Use Out to Artist and Artist Delivery for each round of work. The same saree can go through multiple artists, with every round in its history.'],
  ['Finish and despatch','Send to Ground Staff, then receive finished goods. Despatch jobwork to its company or send TaraFabbs stock to the office.'],
  ['Recover a damaged label','Use Code Recovery, match the physical saree and write the same permanent code on a new tag. A replacement tag does not move stock.']
 ];
 return <div className="workspace-guide"><p>Start with the All-in-one Code Entry when you are unsure of the next step.</p><button className="btn primary" onClick={onScan}><Hash size={17}/>Enter a code</button><ol>{steps.map(([title,detail])=><li key={title}><h3>{title}</h3><p>{detail}</p></li>)}</ol><div className="info-strip"><HelpCircle size={18}/>Type the complete 1–4 character tag code or take a close photo, verify the recognized value, then press Submit.</div><div className="guide-reminder"><Clock size={16}/><p>Your access determines which actions appear. Every submitted movement keeps its history.</p></div></div>;
}
