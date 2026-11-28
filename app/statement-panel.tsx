'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {useInventoryLanguage} from './inventory-language';
import type {Snapshot} from '@/lib/production-types';
import type {StatementFilter,StatementReport} from '@/lib/statements';
import {statementDocument,type StatementSection} from '@/lib/statement-document';
import type {ArtisanMoneyCommand} from '@/lib/artisan-money';
import {isManagement,isOwner} from '@/lib/rules';
import './statements.css';
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
async function request(url:string,init?:RequestInit){const r=await fetch(url,{...init,cache:'no-store',signal:init?.signal||AbortSignal.timeout(25000)});const body=await r.json();if(!r.ok)throw Error(body.error||'Could not load the statement.');return body;}
export default function StatementPanel({data,scope:fixedScope,id:fixedId}:{data:Snapshot;scope?:StatementFilter['scope'];id?:string}){
 const {t:tr}=useInventoryLanguage();
 const [scope,setScope]=useState<StatementFilter['scope']>('overall'),[id,setId]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(today),[revision,setRevision]=useState(0);
 const [report,setReport]=useState<StatementReport>(),[loading,setLoading]=useState(false),[error,setError]=useState(''),[pdfBusy,setPdfBusy]=useState(false);
 const actualScope=fixedScope||scope,actualId=fixedScope?fixedId||'':id;
 useEffect(()=>{
  if(!to||actualScope!=='overall'&&!actualId){setReport(undefined);setLoading(false);return;}
  const controller=new AbortController();let active=true;const deadline=setTimeout(()=>controller.abort(),25000);setLoading(true);setReport(undefined);setError('');
  const timer=setTimeout(()=>{void request('/api/production/statements?'+new URLSearchParams({scope:actualScope,id:actualId,from,to}),{signal:controller.signal}).then(r=>{if(active)setReport(r);}).catch(e=>{if(active)setError(['AbortError','TimeoutError'].includes(e.name)?'Statement loading took too long. Please retry.':e.message);}).finally(()=>{clearTimeout(deadline);if(active)setLoading(false);});},200);
  return ()=>{active=false;clearTimeout(timer);clearTimeout(deadline);controller.abort();};
 },[actualScope,actualId,from,to,revision,data.history]);
 const doc=report?statementDocument(report,tr):null;
 const generate=async()=>{if(!doc)return;setPdfBusy(true);setError('');try{const {downloadStatementPdf}=await import('@/lib/statement-pdf');await downloadStatementPdf(doc,`IMS-${actualScope}-${from||'beginning'}-${to}.pdf`);}catch(e){setError((e as Error).message);}finally{setPdfBusy(false);}};
 return <section className="statement-panel"><h2>{tr('Reports & Statements')}</h2>
  <form className="statement-filters" onSubmit={e=>{e.preventDefault();setRevision(v=>v+1);}}>
   {!fixedScope&&<><label>{tr('Statement type')}<select value={scope} onChange={e=>{setScope(e.target.value as StatementFilter['scope']);setId('');}}><option value="overall">{tr('Overall Statement')}</option><option value="company">{tr('Company Statement')}</option><option value="artisan">{tr('Artisan Statement')}</option></select></label>{scope!=='overall'&&<label>{tr(scope==='company'?'Company':'Artist')}<select required value={id} onChange={e=>setId(e.target.value)}><option value="">{tr('Select profile')}</option>{(scope==='company'?data.companies.filter(c=>!c.office_only):data.artisans).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}</>}
   <label>{tr('From Date')}<input type="date" max={to||today()} value={from} onChange={e=>setFrom(e.target.value)}/></label><label>{tr('To Date')}<input type="date" required min={from||undefined} max={today()} value={to} onChange={e=>setTo(e.target.value)}/></label>
   <button type="submit" disabled={loading||actualScope!=='overall'&&!actualId}>{tr('Generate statement')}</button><button type="button" className="prod-primary" onClick={()=>void generate()} disabled={!doc||loading||pdfBusy}>{tr(pdfBusy?'Generating PDF…':'Download PDF')}</button>
  </form>
  <p>{tr('Leave From Date blank for all recorded history. Opening balance includes everything before From Date.')}</p>
  {loading&&<p role="status">{tr('Loading statement…')}</p>}{error&&<p className="prod-error" role="alert">{tr(error)}</p>}
  {doc&&report&&<><div className="statement-title"><h2>{doc.title}</h2><p>{doc.subtitle}</p><small>{doc.generated}</small></div><div className="prod-metrics statement-metrics">{doc.metrics.map(m=><section key={m.label}><small>{m.label}</small><strong>{m.value}</strong></section>)}</div><div className="statement-notes">{doc.notes.map((n,i)=><p key={i}>{n}</p>)}</div>
   {actualScope==='artisan'&&isManagement(data.user.role)&&<ArtisanMoneyForm key={data.user.id+':'+actualId} artisan={actualId} userId={data.user.id} role={data.user.role} report={report} onSaved={()=>setRevision(v=>v+1)}/>}
   <div className="statement-shortcuts">{doc.sections.map(s=><a key={s.id} href={'#statement-'+actualScope+'-'+actualId+'-'+s.id}>{s.title}</a>)}</div>
   {doc.sections.map(s=><ReportTable key={s.id+report.generatedAt} section={s} anchor={'statement-'+actualScope+'-'+actualId+'-'+s.id}/>)}
  </>}
 </section>;
}
function ReportTable({section:s,anchor}:{section:StatementSection;anchor:string}){
 const {t:tr}=useInventoryLanguage();const [limit,setLimit]=useState(100);
 return <details className="statement-section" id={anchor} open={['companies','artisans','company-entries','artisan-opening-stock','artisan-work','disputes','company-ledger','artisan-ledger'].includes(s.id)}><summary>{s.title} <small>({s.rows.length.toLocaleString('en-IN')})</small></summary>{s.note&&<p className="statement-note">{s.note}</p>}{!s.rows.length?<p>{tr('No entries in this period.')}</p>:<><div className="statement-table-scroll"><table><thead><tr>{s.headers.map((h,i)=><th key={i} scope="col">{h}</th>)}</tr></thead><tbody>{s.rows.slice(0,limit).map((row,i)=><tr key={i}>{row.map((v,j)=><td key={j}>{v}</td>)}</tr>)}</tbody></table></div>{limit<s.rows.length&&<p>{tr('Screen preview only; the PDF includes every row.')} <button type="button" onClick={()=>setLimit(n=>n+100)}>{tr('Show more rows')}</button></p>}</>}</details>;
}
function ArtisanMoneyForm({artisan,userId,role,report,onSaved}:{artisan:string;userId:string;role:string;report:StatementReport;onSaved:()=>void}){
 const {t:tr}=useInventoryLanguage();
 const initial=():ArtisanMoneyCommand=>({artisan,date:today(),kind:'payment',amount:0,reference:'',notes:''});
 const [c,setC]=useState<ArtisanMoneyCommand>(initial),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[hydrated,setHydrated]=useState(false);
 const key=useRef(''),pending=useRef(false),storage='ims-artisan-money:'+userId+':'+artisan;
 useEffect(()=>{try{const saved=JSON.parse(sessionStorage.getItem(storage)||'null');if(saved?.c?.artisan===artisan){setC(saved.c);key.current=saved.key||'';}}catch{/* Optional storage. */}setHydrated(true);},[artisan,storage]);
 useEffect(()=>{if(hydrated)try{sessionStorage.setItem(storage,JSON.stringify({c,key:key.current}));}catch{/* Optional storage. */}},[c,hydrated,storage]);
 const change=(patch:Partial<ArtisanMoneyCommand>)=>{setC(x=>({...x,...patch}));key.current='';setError('');setNotice('');};
 async function submit(e:FormEvent){e.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setError('');key.current||=crypto.randomUUID();try{
  try{sessionStorage.setItem(storage,JSON.stringify({c,key:key.current}));}catch{/* Optional storage. */}
  await request('/api/production/artisan-money',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...c,key:key.current})});key.current='';setC(initial());try{sessionStorage.removeItem(storage);}catch{}setNotice('Saved. Artisan account updated.');onSaved();
 }catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}}
 return <section className="artisan-money-form" id={'artisan-money-'+artisan}><h3>{tr('Artisan Khata — payment / advance')}</h3><p>{tr('Work charges and any payment made while receiving goods are already recorded here. Use this form for a separate advance or a later payment. Future work charges use any remaining advance automatically.')}</p>
  <form onSubmit={submit}><fieldset disabled={busy}><div className="prod-fields"><label>{tr('Action')}<select value={c.kind} onChange={e=>change({kind:e.target.value as ArtisanMoneyCommand['kind'],amount:0})}><option value="payment">{tr('Payment / advance paid to artisan')}</option><option value="refund">{tr('Advance cash returned by artisan')}</option><option value="opening">{tr('Opening due / advance')}</option><option value="charge">{tr('Older work charge not entered at receipt')}</option><option value="adjustment">{tr('Manual signed adjustment')}</option></select></label><label>{tr('Date')}<input type="date" required max={today()} value={c.date} onChange={e=>change({date:e.target.value})}/></label><label>{tr('Amount (₹)')}<input type="number" step="0.01" required min={['opening','adjustment'].includes(c.kind)?undefined:'0.01'} value={c.amount??0} onChange={e=>change({amount:Number(e.target.value)})}/></label><label>{tr('Bill / reference (optional)')}<input maxLength={200} value={c.reference||''} onChange={e=>change({reference:e.target.value})}/></label></div>
   {['opening','adjustment'].includes(c.kind)&&<p>{tr('Positive adds artisan due; negative records advance / reduces due. A reason is required for adjustment.')}</p>}
   <label>{tr('Remarks / Reason')}<textarea rows={2} required={c.kind==='adjustment'} maxLength={4000} value={c.notes||''} onChange={e=>change({notes:e.target.value})}/></label><button className="prod-primary" disabled={busy}>{tr(busy?'Saving / Checking…':'Save artisan money entry')}</button>
  </fieldset></form>{error&&<p role="alert" className="prod-error">{tr(error)}</p>}{notice&&<p role="status" className="prod-success">{tr(notice)}</p>}
  {isOwner(role)&&<details><summary>{tr('Owner: reverse a manual money entry')}</summary>{report.artisanLedger.filter(e=>!e.event_id&&!e.reversed&&e.kind!=='reversal').map(e=><p key={e.id}>{e.date} · {tr(e.kind)} · {new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(e.amount/100)} <button type="button" disabled={busy} onClick={async()=>{const notes=window.prompt(tr('Reason to reverse this money entry?'));if(!notes)return;setBusy(true);setError('');try{await request('/api/production/artisan-money',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({artisan,date:today(),kind:'reversal',entry:e.id,notes,key:crypto.randomUUID()})});onSaved();}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}}}>{tr('Delete / Reverse')}</button></p>)}</details>}
 </section>;
}
