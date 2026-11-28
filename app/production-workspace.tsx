'use client';
import {useInventoryLanguage} from '@/app/inventory-language';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { actions, labels, stages, accountKey, type Account, type Balance, type Command, type Document, type Line } from '@/lib/production';
import { artisanWorkTypes, isManagement, isOfficeRole, isOwner, permitted } from '@/lib/rules';
import SignOutButton from './sign-out-button';
import PhoneField from './phone-field';
import StaffManagement from './staff-management';
import ArtisanReceive from './artisan-receive';
import StatementPanel from './statement-panel';
import { PerformancePanel, StockBreakdownPanel } from './production-dashboard';
import DirectSales, {JobAdvanceNotes} from './direct-sales';
import { artistStages, onSiteStages, stockMetrics, type StockMetric } from '@/lib/production-dashboard';
import './production.css';
import type {Master,Event,Snapshot} from '@/lib/production-types';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const money = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n / 100);
async function json(url:string,init?:RequestInit) {
    try {
        const response=await fetch(url,{...init,cache:'no-store',signal:init?.signal||AbortSignal.timeout(20_000)});
        const result=await response.json();
        if(!response.ok)throw new Error(result.error||'Could not complete request.');
        return result;
    } catch(error) {
        if(error instanceof Error&&['AbortError','TimeoutError'].includes(error.name))throw new Error('The connection took too long. Retry to load stock or check this save.');
        throw error;
    }
}
const post = (url: string, body: unknown) => json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export default function ProductionWorkspace({ office = false,officeAccess=false,initialData,initialError='',initialAction='' }: {
    office?: boolean;
    officeAccess?:boolean;
    initialData?:Snapshot;
    initialError?:string;
    initialAction?:string;
}) {
    const {t:tr}=useInventoryLanguage();

    const [data, setData] = useState<Snapshot|undefined>(initialData);
    const [activeMetric, setActiveMetric] = useState<StockMetric>();
    const [screen, setScreen] = useState(initialAction ? 'entry' : 'home');
    const [company, setCompany] = useState('');
    const [artisan, setArtisan] = useState('');
    const [tab, setTab] = useState('stock');
    const [salesTab,setSalesTab] = useState<'stock'|'bookings'>('stock');
    const [salesRequest,setSalesRequest]=useState(0);
    const [kind, setKind] = useState(initialAction || 'receipt');
    const [page, setPage] = useState(0);
    const [error, setError] = useState(initialError);
    const [notice, setNotice] = useState('');
    const [search, setSearch] = useState('');
    const [profilesView, setProfilesView] = useState('current');
    const [menu, setMenu] = useState(false);
    const [busy, setBusy] = useState(false);
    const [master, setMaster] = useState('');
    const [entrySource,setEntrySource]=useState<Account>();
    const read = useRef(0);
    const refresh = useCallback(async () => { const seq = ++read.current; try {
        const d = await json('/api/production?' + new URLSearchParams({ company, page: String(page), view: office ? 'office' : 'workshop' }));
        if (seq === read.current) {
            setData(d);
            setError('');
        }
    }
    catch (e) {
        setError((e as Error).message);
    } }, [company, page, office]);
    const hasInitialSnapshot=useRef(!!initialData);
    useEffect(() => { if(hasInitialSnapshot.current){hasInitialSnapshot.current=false;return;}void refresh(); }, [refresh]);
    function go(s: string) { if (['home', 'companies', 'artists', 'factory-disputes', 'statements', 'performance','own-products'].includes(s)) {
        setCompany('');
        setArtisan('');
        setPage(0);
    } setActiveMetric(undefined); setScreen(s); setMenu(false); setNotice(''); setError(''); }
    function start(k: string) { setEntrySource(undefined); setKind(k); go('entry'); }
    function takeStockAction(k:string,b:Balance){setCompany(b.company);setArtisan('');setEntrySource(b);setKind(k);go('entry');}
    async function save(c: Command, key: string) { setBusy(true); try {
        const r = await post('/api/production', { ...c, targetCompany: c.kind === 'replacement' ? (c.targetCompany || c.company) : c.targetCompany, key });
        setNotice(r.message);
        void refresh();
        return r;
    }
    finally {
        setBusy(false);
    } }
    if (!data)
        return <main className="prod prod-loading"><h1>IMS TARA MAA</h1><p role="status">{tr(error || 'Loading your stock…')}</p><button onClick={() => void refresh()}>{tr("Reload")}</button></main>;
    const name = (items: Master[], id: string) => items.find(m => m.id === id)?.name || id;
    const balances = data.balances.filter(b => (!company || b.company === company) && (!artisan || b.artisan === artisan));
    const onSite = balances.filter(b => onSiteStages.some(stage => stage === b.stage));
    const withArtists = balances.filter(b => artistStages.some(stage => stage === b.stage));
    const sum = (rows: Balance[]) => rows.reduce((s, b) => s + b.quantity, 0);
    const availableActions = Object.keys(actions).filter(k => permitted(data.user.role, actions[k].permission) && (office ? ['office_receive', 'office_sell', 'office_return', 'office_vendor', 'vendor_return'].includes(k) : true));
    const attention = data.balances.filter(b => ['hold', 'reprint', 'office_return'].includes(b.stage) || (['raw', 'artist', 'office_pending'].includes(b.stage) && Date.now() - Date.parse(b.since || '') > 7 * 864e5));
    const outstanding = data.documents.filter(d => d.settled < d.quantity);
    const nav = ['home', 'companies', ...(!office&&isManagement(data.user.role)?['own-products']:[]), ...(office ? [] : ['artists', 'statements', 'factory-disputes', 'performance', 'company-return', 'dispatch']), 'history', ...(isManagement(data.user.role) ? ['opening', 'stock-check'] : []), ...(isOwner(data.user.role) ? ['access', 'data-control'] : [])];
    const titles: Record<string, string> = { home: 'Home', statements: 'Reports & Statements', performance: 'Performance', companies: 'Companies', 'own-products':'TaraFabbs Own Product', artists: 'Artisans', 'company-return': 'Company Return', dispatch: 'Dispatch Done', 'factory-disputes': 'Factory Disputes', history: 'History', opening: 'Opening Balance', 'stock-check': 'Stock Check', access: 'Staff Access', 'data-control': 'Owner Data Control' };
    const companyData = data.companies.find(c => c.id === company);
    const matchesProfile=(p:Master)=>profilesView==='all'||(profilesView==='current'?['active','paused'].includes(profileStatus(p)):profileStatus(p)===profilesView);
    return <div className={officeAccess ? 'prod prod-with-inventory-switch' : 'prod'}>
 {officeAccess && <nav className="prod-inventory-switch" aria-label={tr('Inventory')}>
  <span>{tr('Inventory')}</span>
  <div role="group" aria-label={tr('Inventory')}>
   <a href="/" aria-current={!office ? 'page' : undefined}>{tr('Workshop Inventory')}</a>
   <a href="/?view=Office" aria-current={office ? 'page' : undefined}>{tr('Office Inventory')}</a>
  </div>
 </nav>}
 <header className="prod-header"><button aria-label={tr("Open menu")} aria-expanded={menu} onClick={() => setMenu(!menu)}>☰</button><div><strong>IMS TARA MAA</strong><small>{office ? tr("Office Inventory") : tr("Workshop Stock")}</small></div><button className="prod-alert" onClick={() => go('issues')}>{tr("Fix Issues ·")} {(attention.length + outstanding.length)}</button>{!office&&isManagement(data.user.role)&&<button className="prod-advance" onClick={()=>{setSalesTab('bookings');setSalesRequest(n=>n+1);go('own-products');}}>{tr('Advance Orders')}</button>}<span className="prod-user">{data.user.name} · {data.user.role === 'Admin' ? tr("Owner") : tr(data.user.role)}</span></header>
 <aside className={menu ? 'prod-nav open' : 'prod-nav'} aria-label={tr("Main navigation")}>{nav.map(s => <button key={s} aria-current={screen === s ? 'page' : undefined} onClick={() => { if (s === 'opening') {
        start('opening');
    }
    else if (s === 'stock-check') {
        start('stock_count');
    }
    else if(s==='own-products'){setSalesTab('stock');setSalesRequest(n=>n+1);go(s);}
    else
        go(s); }}>{tr(titles[s])}</button>)}<button onClick={() => start(office ? 'office_receive' : 'receipt')}>{tr("＋ New Entry")}</button><button onClick={() => go('movement')}>{tr("Stock Movement")}</button><button onClick={() => go('catalog')}>{tr("Manage Profiles")}</button><a href="/archive">{tr("Previous History (read only)")}</a><SignOutButton /></aside>
 <main className="prod-main">
 {error && <p role="alert" className="prod-error">{tr(error)} <button onClick={() => void refresh()}>{tr("Reload")}</button></p>}{notice && <p role="status" className="prod-success">{tr(notice)}</p>}
 <div className="prod-heading"><h1>{screen === 'entry' ? tr(actions[kind]?.label||'') : screen === 'company' ? companyData?.name : tr(titles[screen] || 'Stock Management')}</h1><input aria-label={tr("Search companies, artists or stock")} placeholder={tr("Search…")} value={search} onChange={e => setSearch(e.target.value)}/></div>
 {screen === 'home' && <>
 <div className="prod-metrics prod-home-metrics">{(Object.keys(stockMetrics) as StockMetric[]).map(metric => {
    const { label, stages } = stockMetrics[metric];
    const quantity = sum(balances.filter(row => stages.some(stage => stage === row.stage)));
    return <button className="prod-metric-button" type="button" key={metric} aria-expanded={activeMetric === metric}
        aria-controls={activeMetric === metric ? 'home-stock-breakdown' : undefined}
        onClick={() => setActiveMetric(activeMetric === metric ? undefined : metric)}>
        <small>{tr(label)}</small><strong className="prod-number">{quantity.toLocaleString('en-IN')} <small>{tr('pcs')}</small></strong>
        <span>{tr(activeMetric === metric ? 'Hide breakdown' : 'View breakdown')} {activeMetric === metric ? '▴' : '▾'}</span>
    </button>;
 })}</div>
 {!office && <div className="prod-actions prod-home-shortcuts">
    <button onClick={() => go('factory-disputes')}>{tr('Factory Disputes')}</button>
    <button onClick={() => go('performance')}>{tr('Performance')}</button>
 </div>}
 {activeMetric && <StockBreakdownPanel data={data} metric={activeMetric} office={office}/>}
 <div className="prod-actions">{(office ? ['office_receive', 'office_sell', 'office_return'] : ['receipt', 'issue', 'receive', 'dispatch', 'company_return', 'dispute']).filter(k => availableActions.includes(k)).map(k => <button key={k} onClick={() => start(k)}>{tr(actions[k].label)}</button>)}</div><section><h2>{tr("Dispatch Done")}</h2><p>{tr("Company-wise bills, date, product quantities and optional GST bill number.")}</p><button onClick={() => go('dispatch')}>{tr("View Dispatches")}</button></section><StockCards rows={balances.filter(b => !['delivered', 'raw_returned', 'damaged', 'office_sold'].includes(b.stage))} data={data} search={search}/></>}
 {screen === 'companies' && <>{(permitted(data.user.role,'masterCreate')||isOfficeRole(data.user.role)&&permitted(data.user.role,'officeMaster'))&&<button onClick={()=>setMaster('company')}>{tr('＋ Create Company')}</button>}<ProfileFilter value={profilesView} change={setProfilesView}/><div className="prod-grid">{data.companies.filter(c=>c.ownership!=='OWN').filter(matchesProfile).filter(c => c.name.toLowerCase().includes(search.toLowerCase())).map(c => <section key={c.id}><h2>{c.name}</h2><p>{sum(data.balances.filter(b => b.company === c.id && ['raw', 'ready', 'hold', 'artist', 'reprint'].includes(b.stage)))}  {tr("pcs in our custody")}</p>{!office && <p>{tr("Due / credit:")} {money(Number(data.money.find(m => m.company === c.id)?.due || 0))}</p>}<button onClick={() => { setCompany(c.id); setArtisan(''); setPage(0); go('company'); }}>{tr("Open profile")}</button>{!office&&<button onClick={()=>{setCompany(c.id);setArtisan('');setPage(0);setTab('statement');go('company');}}>{tr('Statement / PDF')}</button>}<ProfileStatusControls kind="company" item={c} owner={isOwner(data.user.role)} saved={refresh}/></section>)}</div></>}
 {screen==='own-products'&&!office&&isManagement(data.user.role)&&<><div className="prod-actions"><button onClick={()=>setMaster('company:'+(data.companies.find(c=>c.ownership==='OWN'&&!c.office_only)?.id||'own'))}>{tr('Manage TaraFabbs Stock Profile')}</button></div>{data.companies.filter(c=>c.ownership==='OWN'&&!c.office_only).map(c=><ProfileStatusControls key={c.id} kind="company" item={c} owner={isOwner(data.user.role)} saved={refresh}/>)}<DirectSales data={data} initialTab={salesTab} tabRequest={salesRequest} onProductionRefresh={()=>{void refresh();}} onStockAction={(action,id)=>{setCompany(id||'');start(action);}}/></>}
 {screen === 'company' && <><button onClick={() => { setCompany(''); go('companies'); }}>{tr("← All Companies")}</button>{companyData&&<ProfileStatusControls kind="company" item={companyData} owner={isOwner(data.user.role)} saved={refresh}/>}<div className="prod-tabs">{['stock', 'khata', 'statement', 'reports', 'damage'].map(t => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{tr(({ stock: 'Stock & Progress', statement: 'Statement / PDF', khata: 'Company Khata', reports: 'Reports', damage: 'Damage Charge' })[t])}</button>)}</div>
 {tab === 'stock' && <><div className="prod-metrics"><Metric label={tr("In factory")} n={sum(onSite)}/><Metric label={tr("With artists")} n={sum(withArtists)}/><Metric label={tr("Total in custody")} n={sum(onSite) + sum(withArtists)}/><Metric label={tr("With company")} n={sum(balances.filter(b => b.stage === 'delivered'))}/></div><div className="prod-actions">{['receipt', 'issue', 'receive', 'dispatch', 'company_return'].filter(k => availableActions.includes(k)).map(k => <button key={k} onClick={() => start(k)}>{tr(actions[k].label)}</button>)}</div><h2>{tr("Main Production")}</h2><StockCards rows={balances.filter(b => b.pool === 'normal')} data={data} search={search}/><h2>{tr("Company Return — Separate Stock")}</h2><StockCards rows={balances.filter(b => b.pool === 'company_return')} data={data} search={search}/></>}
 {tab === 'khata' && <><h2>{tr("Due / Advance:")} {money(Number(data.money.find(m => m.company === company)?.due || 0))}</h2><p>{tr("Negative balance means company advance / credit. Payments do not need bill allocation.")}</p><div className="prod-actions">{['dispatch', 'payment'].filter(k => availableActions.includes(k)).map(k => <button key={k} onClick={() => start(k)}>{tr(actions[k].label)}</button>)}</div><JobAdvanceNotes company={company}/><History data={data} company={company} save={save}/></>}
 {tab === 'statement' && <StatementPanel data={data} scope="company" id={company}/>}
 {tab === 'reports' && <Reports rows={balances} company={company}/>}
 {tab === 'damage' && <><div className="prod-actions">{['damage', 'replacement', 'order', 'order_receive', 'settle'].filter(k => availableActions.includes(k)).map(k => <button key={k} onClick={() => start(k)}>{tr(actions[k].label)}</button>)}</div>{data.documents.filter(d => d.company === company).map(d => <section key={d.id}><h3>{d.kind === 'damage' ? tr("Damage") : tr("Replacement Order")} · {d.payload.date}</h3><p>{d.quantity}  {tr("pcs · Settled/Received")} {d.settled}  {tr("· Pending")} {d.quantity - d.settled}</p><p>{d.payload.notes}</p><p>{tr("Recorded cost / amount:")} {money(d.amount)}</p></section>)}<History data={data} company={company} save={save}/></>}
 </>}
 {screen === 'artists' && <><ProfileFilter value={profilesView} change={setProfilesView}/><div className="prod-actions"><button onClick={() => setMaster('artisan')}>{tr("＋ Create Artisan")}</button>{permitted(data.user.role,'masterCreate')&&<button onClick={()=>setMaster('art_style')}>{tr('＋ Create Art Style')}</button>}</div><select aria-label={tr("Select artist")} value={artisan} onChange={e => setArtisan(e.target.value)}><option value="">{tr("All artisans")}</option>{data.artisans.filter(matchesProfile).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select><div className="prod-grid">{data.artisans.filter(matchesProfile).filter(a => (!artisan || a.id === artisan) && a.name.toLowerCase().includes(search.toLowerCase())).map(a => <section key={a.id}><h2>{a.name}</h2><p>{(a.work_types || [a.work_type]).join(', ')}</p><p>{tr("Total pending:")} {sum(data.balances.filter(b => b.artisan === a.id))}  {tr("pcs")}</p><button onClick={() => setArtisan(a.id)}>{tr("View pending")}</button><button onClick={() => setMaster('artisan:' + a.id)}>{tr("Edit profile")}</button><ProfileStatusControls kind="artisan" item={a} owner={isOwner(data.user.role)} saved={refresh}/></section>)}</div><StockCards rows={data.balances.filter(b => !!b.artisan && (!artisan || b.artisan === artisan))} data={data} search={search}/>{artisan&&<><StatementPanel data={data} scope="artisan" id={artisan}/><ArtistSummary artisan={artisan}/><History data={data} defaultArtist={artisan} save={save}/></>}</>}
 {screen === 'company-return' && <><p>{tr("Company totals only. No bill matching. This stock never mixes with internal reprint.")}</p><div className="prod-actions">{['company_return', 'return_send', 'return_receive', 'dispatch'].filter(k => availableActions.includes(k)).map(k => <button key={k} onClick={() => start(k)}>{tr(actions[k].label)}</button>)}</div><StockCards rows={balances.filter(b => b.pool === 'company_return')} data={data} search={search}/></>}
 {screen === 'performance' && !office && <PerformancePanel data={data} search={search} companyStatement={id => {
    setCompany(id); setArtisan(''); setPage(0); setTab('statement'); go('company');
 }}/>}
 {screen === 'statements' && !office && <StatementPanel data={data}/>}
 {screen === 'movement' && <div className="prod-actions">{availableActions.map(k => <button key={k} onClick={() => start(k)}>{tr(actions[k].label)}</button>)}</div>}
 {screen === 'entry' && (kind === 'receive' ? <ArtisanReceive key={entrySource?accountKey(entrySource):'receive'} data={data} busy={busy} save={save} initialArtisan={entrySource?.artisan} initialCompany={entrySource?.company}/> : <Entry key={kind + company+(entrySource?accountKey(entrySource):'')} kind={kind} data={data} company={company} busy={busy} save={save} master={setMaster} onAction={start} initialSource={entrySource}/>)}
 {screen === 'factory-disputes' && <><h2>{tr('Factory Disputes')}</h2><p>{tr('Includes factory hold and repaint pending with artisans. Artisan repaint is shown here for tracking and counted only once in total stock.')}</p><StockCards rows={balances.filter(b => b.pool === 'normal' && ['hold', 'reprint'].includes(b.stage))} data={data} search={search} takeAction={takeStockAction}/></>}
 {['history', 'dispatch'].includes(screen) && <><label>{tr("Company")}<select value={company} onChange={e => { setCompany(e.target.value); setPage(0); }}><option value="">{tr("All companies")}</option>{data.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><History data={data} company={company} defaultKind={screen === 'dispatch' ? 'dispatch' : ''} save={save}/></>}
 {screen === 'issues' && <><h2>{tr("Needs Attention")}</h2><p>{tr("Raw / artist / transfer attention threshold: 7 days. Disputes and unsettled damage are shown immediately.")}</p><StockCards rows={attention} data={data} search={search}/>{outstanding.map(d => <section key={d.id}><strong>{name(data.companies, d.company)} · {d.kind}</strong><p>{d.quantity - d.settled}  {tr("pcs unsettled ·")} {d.payload.date}</p><p>{d.payload.notes}</p><button onClick={() => { setCompany(d.company); setTab('damage'); go('company'); }}>{tr("Resolve in profile")}</button></section>)}</>}
 {screen === 'catalog' && <><div className="prod-actions">{['company', 'product', ...(!office ? ['artisan','art_style'] : [])].map(t => <button key={t} onClick={() => setMaster(t)}>{tr("Create")} {tr(t)}</button>)}</div><ProfileFilter value={profilesView} change={setProfilesView}/>{data.companies.filter(c=>c.ownership!=='OWN').filter(matchesProfile).map(c => <section key={c.id}><h3>{c.name}</h3><p>{c.contact} {c.address}</p><button onClick={() => setMaster('company:' + c.id)}>{tr("Edit company")}</button><ProfileStatusControls kind="company" item={c} owner={isOwner(data.user.role)} saved={refresh}/></section>)}</>}
 {screen === 'data-control' && isOwner(data.user.role) && <OwnerControl data={data} save={save}/>}
 {screen === 'access' && isOwner(data.user.role) && <StaffManagement currentUser={data.user.id} request={json} save={async (values: Record<string, unknown>) => { await post('/api/ledger', { op: 'user', key: crypto.randomUUID(), data: values }); }}/>}
 {master && <MasterForm type={master} data={data} office={office} close={() => setMaster('')} saved={() => { setMaster(''); void refresh(); }}/>}
 </main><nav className="prod-bottom" aria-label={tr("Mobile navigation")}><button onClick={() => go('home')}>{tr("⌂ Home")}</button><button onClick={() => start(office ? 'office_receive' : 'receipt')}>{tr("＋ Entry")}</button><button onClick={() => go('movement')}>{tr("⇄ Movement")}</button><button onClick={() => setMenu(!menu)}>{tr("☰ Menu")}</button></nav></div>;
}
const statusLabels={active:'Active',paused:'Paused',archived:'Archived',deleted:'Deleted (history kept)'};
function profileStatus(item:Master):keyof typeof statusLabels{return item.profile_status&&item.profile_status!=='active'?item.profile_status:item.active?'active':'paused';}
function ProfileFilter({value,change}:{value:string;change:(v:string)=>void}){
 const {t:tr}=useInventoryLanguage();return <label className="prod-profile-filter">{tr('Profile list')}<select value={value} onChange={e=>change(e.target.value)}>{[['current','Current profiles'],['active','Active'],['paused','Paused'],['archived','Archived'],['deleted','Deleted (history kept)'],['all','All profiles (including history)']].map(([v,label])=><option key={v} value={v}>{tr(label)}</option>)}</select></label>;
}
function ProfileStatusControls({kind,item,owner,saved}:{kind:'company'|'artisan';item:Master;owner:boolean;saved:()=>Promise<unknown>}){
 const {t:tr}=useInventoryLanguage(),[target,setTarget]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');const key=useRef('');
 const status=profileStatus(item),label=({active:'Restore / Resume',paused:'Pause',archived:'Archive',deleted:'Delete (history kept)'} as Record<string,string>);
 async function apply(){if(busy||!target||!reason.trim())return;setBusy(true);setError('');key.current ||= crypto.randomUUID();try{await post('/api/production/profile-status',{kind,id:item.id,status:target,reason,key:key.current});setTarget('');setReason('');key.current='';await saved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="prod-profile-status"><p>{tr('Profile status:')} <strong>{tr(statusLabels[status])}</strong></p>{owner&&<details><summary>{tr('Manage status')}</summary><p>{tr('History, stock and money stay unchanged. Inactive profiles cannot receive new stock or new work; existing stock and payments can still be settled.')}</p><div className="prod-actions">{Object.keys(statusLabels).filter(s=>s!==status).map(s=><button type="button" key={s} disabled={busy} onClick={()=>{setTarget(s);setReason('');setError('');key.current='';}}>{tr(label[s])}</button>)}</div>{target&&<div role="group" aria-label={tr('Confirm profile status')}><p><strong>{item.name} · {tr(label[target])}</strong></p>{target==='deleted'&&<p>{tr('Delete hides this profile from current lists. Its history and balances remain available; Owner can restore it later.')}</p>}<label>{tr('Reason for status change')}<textarea required maxLength={2000} value={reason} disabled={busy} onChange={e=>{setReason(e.target.value);key.current='';}}/></label><div className="prod-actions"><button type="button" disabled={busy} onClick={()=>{setTarget('');setError('');}}>{tr('Cancel')}</button><button type="button" disabled={busy||!reason.trim()} onClick={()=>void apply()}>{tr(busy?'Saving…':'Confirm status change')}</button></div></div>}{error&&<p role="alert" className="prod-error">{tr(error)}</p>}</details>}</div>;
}
function artworkOptions(data:Snapshot,selected:string[]=[]){return Array.from(new Set([...artisanWorkTypes,...(data.artStyles||[]).filter(s=>s.active).map(s=>s.name),...data.artisans.flatMap(a=>a.work_types||[a.work_type||'']),...selected].filter(Boolean)));}
function Metric({ label, n }: {
    label: string;
    n: number;
}) {
    const {t:tr}=useInventoryLanguage();
 return <section><small>{label}</small><strong className="prod-number">{n.toLocaleString('en-IN')} <small>{tr("pcs")}</small></strong></section>; }
function StockCards({ rows, data, search, takeAction }: {
    rows: Balance[];
    data: Snapshot;
    search: string;
    takeAction?:(kind:string,b:Balance)=>void;
}) {
    const {t:tr}=useInventoryLanguage();
 const name = (list: Master[], id: string) => list.find(x => x.id === id)?.name || id; return <div className="prod-grid">{rows.filter(b => [name(data.companies, b.company), name(data.products, b.product), name(data.artisans, b.artisan), b.arts, b.work,labels[b.stage],tr(labels[b.stage])].join(' ').toLowerCase().includes(search.toLowerCase())).map(b => <section key={accountKey(b)}><small>{name(data.companies, b.company)} · {b.pool === 'company_return' ? tr("Company Return") : tr("Production")}</small><h3>{name(data.products, b.product)}</h3><p>{tr(labels[b.stage])} {b.artisan ? ('· ' + name(data.artisans, b.artisan)) : ''}</p><strong className="prod-number">{b.quantity}  {tr("pcs")}</strong><p>{tr("Completed:")} {b.arts || tr('No artwork yet')}</p>{b.work && <p>{tr("Current work:")} {b.work}</p>}{takeAction&&<DisputeActions balance={b} role={data.user.role} takeAction={takeAction}/>}</section>)}{!rows.length && <p>{tr("No stock in this section.")}</p>}</div>; }
function DisputeActions({balance:b,role,takeAction}:{balance:Balance;role:string;takeAction:(kind:string,b:Balance)=>void}){
 const {t:tr}=useInventoryLanguage();const options=(b.stage==='reprint'?['receive']:b.stage==='hold'?['reprint','damage',...(!b.arts?['dispatch']:[])]:[]).filter(k=>permitted(role,actions[k].permission));
 return options.length?<details className="prod-dispute-actions"><summary>{tr('Take action')}</summary><div className="prod-actions">{options.map(k=><button type="button" key={k} onClick={()=>takeAction(k,b)}>{tr(k==='dispatch'?'Return raw dispute to company · Bill & Dispatch':actions[k].label)}</button>)}</div></details>:null;
}
const sources: Record<string, string[]> = { issue: ['raw'], additional: ['ready'], reprint: ['ready', 'hold'], return_send: ['hold', 'ready'], receive: ['artist', 'reprint'], return_receive: ['artist', 'reprint'], dispute: ['raw', 'ready'], damage: ['raw', 'ready', 'hold'], dispatch: ['ready', 'hold'], company_return: ['delivered'], replacement: ['raw', 'ready'], office_send: ['ready'], office_receive: ['office_pending'], office_sell: ['office_stock'], office_return: ['office_stock', 'office_sold'], office_factory_receive: ['office_return'], vendor_return: ['office_stock'], stock_count: ['raw', 'ready', 'hold', 'office_stock'] };
function Entry({ kind, data, company, busy, save, master, onAction, initialSource }: {
    kind: string;
    data: Snapshot;
    company: string;
    busy: boolean;
    save: (c: Command, key: string) => Promise<unknown>;
    master: (s: string) => void;
    onAction: (s: string) => void;
    initialSource?:Account;
}) {
    const {t:tr}=useInventoryLanguage();

    const initial = (): Command => ({ kind, date: kind === 'opening' ? (data.openingDate || today()) : today(), company, lines: [], amount: 0, notes: '', reference: '' });
    const [c, setC] = useState<Command>(initial);
    const [line, setLine] = useState<Line>(()=>({ quantity: 1,source:initialSource }));
    const [openingStage, setOpeningStage] = useState<Account['stage']>('raw');
    const [openingPool, setOpeningPool] = useState<Account['pool']>('normal');
    const [arts, setArts] = useState('');
    const [counted, setCounted] = useState(0);
    const [sourceSearch, setSourceSearch] = useState('');
    const [error, setError] = useState('');
    const [restored, setRestored] = useState(false);
    const key = useRef('');
    const pending = useRef(false);
    const draftName = 'ims-production-draft:' + data.user.id + ':' + kind + ':' + company+(initialSource?':stock:'+accountKey(initialSource):'');
    useEffect(() => { try {
        const draft = sessionStorage.getItem(draftName);
        if (draft) {
            const stored = JSON.parse(draft);
            setC(stored.c);
            key.current = stored.key || '';
            setRestored(true);
        }
    }
    catch { /* Storage can be disabled. */ } }, [draftName]);
    useEffect(() => { try {
        sessionStorage.setItem(draftName, JSON.stringify({ c, key: key.current }));
    }
    catch { /* Saving remains available without browser storage. */ } }, [c, draftName]);
    const edit = (v: Partial<Command>) => { key.current = ''; setC(x => ({ ...x, ...v })); setError(''); };
    const pool = kind.startsWith('return_') ? 'company_return' : kind === 'company_return' ? 'normal' : undefined;
    const eligible = data.balances.filter(b => (sources[kind] || []).includes(b.stage) && (!c.company || b.company === c.company || kind === 'replacement') && (!pool || b.pool === pool) && (!['issue', 'additional', 'reprint', 'damage', 'dispute'].includes(kind) || b.pool === 'normal') && (kind !== 'replacement' || data.companies.find(x => x.id === b.company)?.ownership === 'OWN') && (kind !== 'dispatch' || b.stage !== 'hold' || b.pool === 'normal' && !b.arts));
    const describe = (a: Account) => [data.companies.find(x => x.id === a.company)?.name, data.products.find(x => x.id === a.product)?.name, a.pool === 'company_return' ? tr('Company Return') : tr('Production'), tr(labels[a.stage]), a.artisan ? data.artisans.find(x => x.id === a.artisan)?.name : '', a.arts || tr('No completed art'), a.work].filter(Boolean).join(' · ');
    const balance = line.source ? data.balances.find(b => accountKey(b) === accountKey(line.source!))?.quantity || 0 : 0;
    const reserved = line.source ? (c.lines || []).filter(l => l.source && accountKey(l.source) === accountKey(line.source!)).reduce((s, l) => s + l.quantity, 0) : 0;
    const needsLines = !['payment', 'settle', 'order'].includes(kind);
    const sourceRequired = !!sources[kind];
    const artistSend = ['issue', 'additional', 'reprint', 'return_send'].includes(kind);
    const receiving = ['receive', 'return_receive'].includes(kind);
    const preferenceCompany=kind==='issue'&&line.source?.stage==='raw'?line.source.company:'';
    const preferenceProduct=preferenceCompany?line.source?.product||'':'';
    const preferenceKey=JSON.stringify([preferenceCompany,preferenceProduct]);
    const [preferences,setPreferences]=useState<{key:string;artworks:string[];error?:string}>({key:'',artworks:[]});
    useEffect(()=>{let active=true;if(preferenceCompany&&preferenceProduct){void json('/api/production/records?'+new URLSearchParams({mode:'preferences',company:preferenceCompany,product:preferenceProduct})).then(r=>{if(active)setPreferences({key:preferenceKey,artworks:r.artworks||[]});}).catch(()=>{if(active)setPreferences({key:preferenceKey,artworks:[],error:'Could not load preferred artwork. You can still choose the actual artwork.'});});}return()=>{active=false;};},[preferenceCompany,preferenceProduct,preferenceKey]);
    const selectedCompany=data.companies.find(x=>x.id===c.company);
    const receiptScopeError = kind === 'receipt' && selectedCompany?.office_only ? 'This company is an Office-only vendor. Choose a Workshop company for New Entry. Your product lines are kept when you change company.' : kind === 'receipt' && selectedCompany && !selectedCompany.active ? 'Restore this company before adding new stock. Existing stock and payments can still be settled.' : '';
    function addLine() { try {
        if (receiptScopeError) throw new Error(receiptScopeError);
        if (!Number.isInteger(line.quantity) || line.quantity < 1)
            throw new Error('Enter a whole quantity.');
        if (sourceRequired && !line.source)
            throw new Error('Choose source stock.');
        if (!sourceRequired && !(line.product))
            throw new Error('Choose category.');
        if (sourceRequired && line.quantity + reserved > balance && kind !== 'stock_count')
            throw new Error('Quantity exceeds remaining stock.');
        if (artistSend && (!line.artisan || !line.artwork))
            throw new Error('Choose artist and artwork.');
        let next = { ...line, company: line.company || c.company };
        if (kind === 'opening') {
            next.source = { company: next.company || '', product: next.product || '', stage: openingStage, pool: openingPool, artisan: ['artist', 'reprint'].includes(openingStage) ? line.artisan || '' : '', work: ['artist', 'reprint'].includes(openingStage) ? line.artwork || '' : '', arts };
        }
        edit({ lines: [...(c.lines || []), next] });
        setLine({ quantity: 1 });
    }
    catch (e) {
        setError((e as Error).message);
    } }
    async function submit(e: FormEvent) { e.preventDefault(); if (pending.current)
        return; if (receiptScopeError) { setError(receiptScopeError); return; } pending.current = true; setError(''); key.current ||= crypto.randomUUID(); try {
        sessionStorage.setItem(draftName, JSON.stringify({ c, key: key.current }));
    }
    catch { } try {
        await save(c, key.current);
        setC(initial());
        key.current = '';
        setRestored(false);
        sessionStorage.removeItem(draftName);
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        pending.current = false;
    } }
    const artworks = artworkOptions(data);
    return <form className="prod-form" onSubmit={submit}><fieldset disabled={busy}>
 {restored && <p>{tr("Unsaved draft restored.")}</p>}
 {permitted(data.user.role, 'masterCreate') && <div className="prod-actions">{!artistSend&&<button type="button" onClick={() => master('company')}>{tr("＋ Create Company")}</button>}<button type="button" onClick={() => master('artisan')}>{tr("＋ Create Artisan")}</button>{!isOfficeRole(data.user.role)&&<button type="button" onClick={()=>master('art_style')}>{tr('＋ Create Art Style')}</button>}</div>}<div className="prod-fields"><label>{tr("Date")}<input type="date" value={c.date} required max={today()} onChange={e => edit({ date: e.target.value })}/></label><label>{tr("Company / Party")}<select required value={c.company || ''} onChange={e => { edit({ company: e.target.value, lines: kind === 'receipt' ? (c.lines || []).map(l => ({ ...l, company: e.target.value })) : [] }); if (kind !== 'receipt') setLine({ quantity: 1 }); }}><option value="">{tr("Select company")}</option>{kind === 'receipt' && receiptScopeError && <option value={c.company} disabled>{data.companies.find(x => x.id === c.company)?.name} · {tr(selectedCompany?.office_only?'Office inventory':statusLabels[profileStatus(selectedCompany!)])}</option>}{data.companies.filter(x => (x.active || !['receipt','office_vendor','opening'].includes(kind)) && (kind !== 'receipt' || !x.office_only)).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>{tr("Bill / Challan No. (optional)")}<input value={c.reference || ''} onChange={e => edit({ reference: e.target.value })}/></label></div>
 {receiptScopeError && <p role="alert">{tr(receiptScopeError)}</p>}
 {kind === 'opening' && <p>{tr("Enter each stock location once. Artist stock automatically appears in company totals. Financial opening: positive = due, negative = advance. Opening date applies to all accounts.")}</p>}
 {needsLines && <section><h2>{tr("Product Lines")}</h2>
 {sourceRequired && !artistSend && <label>{tr("Find source stock")}<input value={sourceSearch} onChange={e => setSourceSearch(e.target.value)} placeholder={tr("Company, category, artist or artwork")}/></label>}
 {sourceRequired ? <label>{tr("Available stock")}<select value={line.source ? accountKey(line.source) : ''} onChange={e => { const b = eligible.find(b => accountKey(b) === e.target.value); setLine({ ...line, ...(kind === 'stock_count' && b ? { quantity: Math.abs(b.quantity - counted), adjustment: counted < b.quantity ? 'shortage' as const : 'surplus' as const } : {}), source: b ? { company: b.company, product: b.product, pool: b.pool, stage: b.stage, artisan: b.artisan, arts: b.arts, work: b.work } : undefined }); }}><option value="">{tr("Choose available stock")}</option>{eligible.filter(b => (describe(b)+' '+labels[b.stage]+' '+(b.pool==='company_return'?'Company Return':'Production')).toLowerCase().includes(sourceSearch.toLowerCase())).map(b => <option key={accountKey(b)} value={accountKey(b)}>{describe(b)} · {b.quantity}  {tr("pcs")}</option>)}</select></label> : <label>{tr("Product Category")}<select value={line.product || ''} onChange={e => setLine({ ...line, product: e.target.value })}><option value="">{tr("Select category")}</option>{data.products.filter(x => x.active && (kind === 'office_vendor' ? x.office_only : !x.office_only)).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
 {preferenceCompany&&<aside className="prod-preferred" aria-live="polite"><small>{tr('Preferred artwork:')} <strong>{preferences.key!==preferenceKey?tr('Loading…'):preferences.error?tr(preferences.error):preferences.artworks.length?preferences.artworks.join(', '):tr('No preference recorded')}</strong></small><small>{tr('Receipt preferences are a reference for this company/category. You can choose a different actual artwork.')}</small></aside>}
 {!sourceRequired && permitted(data.user.role, 'masterCreate') && <button type="button" onClick={() => master('product')}>{tr("＋ Create category")}</button>}
 {kind === 'opening' && <div className="prod-fields"><label>{tr("Opening Location")}<select value={openingStage} onChange={e => setOpeningStage(e.target.value as Account['stage'])}>{stages.filter(s => !['raw_returned', 'office_sold'].includes(s)).map(s => <option key={s} value={s}>{tr(labels[s])}</option>)}</select></label><label>{tr("Stock Type")}<select value={openingPool} onChange={e => setOpeningPool(e.target.value as Account['pool'])}><option value="normal">{tr("Main Production")}</option><option value="company_return">{tr("Company Return")}</option></select></label><label>{tr("Completed Artwork (separate with +)")}<input value={arts} onChange={e => setArts(e.target.value)}/></label></div>}
 {(artistSend || kind === 'opening' && ['artist', 'reprint'].includes(openingStage)) && <div className="prod-fields"><label>{tr("Artist")}<select value={line.artisan || ''} onChange={e => setLine({ ...line, artisan: e.target.value })}><option value="">{tr("Select artist")}</option>{[...data.artisans].filter(a => a.active).sort((a, b) => Number((b.work_types || []).includes(line.artwork || '')) - Number((a.work_types || []).includes(line.artwork || ''))).map(a => <option key={a.id} value={a.id}>{a.name} · {(a.work_types || [a.work_type]).join(', ')}</option>)}</select></label><label>{tr("Actual Artwork")}<select value={line.artwork || ''} onChange={e => setLine({ ...line, artwork: e.target.value })}><option value="">{tr("Select work")}</option>{artworks.map(a => <option key={a}>{a}</option>)}</select></label></div>}
 {kind === 'receipt' && <label>{tr("Preferred Artwork (optional)")}<select value={line.preferred || ''} onChange={e => setLine({ ...line, preferred: e.target.value })}><option value="">{tr("No preference")}</option>{artworks.map(a => <option key={a}>{a}</option>)}</select></label>}
 {(receiving || kind === 'order_receive') && <label>{tr("Receive Into")}<select value={line.outcome || 'ready'} onChange={e => setLine({ ...line, outcome: e.target.value as Line['outcome'] })}>{(receiving ? ['ready', 'hold'] : ['raw', 'ready']).map(s => <option key={s} value={s}>{s === 'ready' ? tr("Ready to Dispatch") : s === 'raw' ? tr("Raw / White") : tr("Factory Dispute / Hold")}</option>)}</select></label>}
 {kind === 'stock_count' ? <label>{tr("Physically Counted Quantity")}<input type="number" inputMode="numeric" min="0" step="1" value={counted} onChange={e => { const n = Number(e.target.value); setCounted(n); setLine({ ...line, quantity: Math.abs(balance - n), adjustment: n < balance ? 'shortage' : 'surplus' }); }}/></label> : <label>{tr("Quantity (pcs)")}<input type="number" inputMode="numeric" min="1" max="1000000" step="1" value={line.quantity} onChange={e => setLine({ ...line, quantity: Number(e.target.value) })}/></label>}
 {kind === 'stock_count' && line.source && <p className="prod-preview">{tr("System")} {balance}  {tr("· Counted")} {counted}  {tr("· Difference")} {counted - balance}</p>}{kind !== 'stock_count' && line.source && <p className="prod-preview">{tr("Available")} {balance}  {tr("→ In this entry")} {(reserved + line.quantity)}  {tr("→ Remaining")} {balance - reserved - line.quantity}</p>}
 <button type="button" onClick={addLine}>{tr("＋ Add line")}</button>
 <ul>{(c.lines || []).map((l, i) => <li key={i}>{l.source ? describe(l.source) : data.products.find(p => p.id === l.product)?.name} · <b>{l.quantity}  {tr("pcs")}</b>{l.artwork ? (tr(" · Work: ") + l.artwork) : ''}{l.preferred ? (tr(" · Preferred: ") + l.preferred) : ''} <button type="button" aria-label={(tr("Remove line ") + (i + 1))} onClick={() => edit({ lines: c.lines!.filter((_, j) => i !== j) })}>{tr("Remove")}</button></li>)}</ul><strong>{tr("Total:")} {(c.lines || []).reduce((s, l) => s + l.quantity, 0)}  {tr("pcs")}</strong>
 </section>}
 {['replacement', 'settle', 'order', 'order_receive'].includes(kind) && <label>{kind === 'order_receive' ? tr("Replacement Order") : tr("Unsettled Damage")}<select required value={c.document || ''} onChange={e => edit({ document: e.target.value })}><option value="">{tr("Select record")}</option>{data.documents.filter(d => d.kind === (kind === 'order_receive' ? 'order' : 'damage') && d.settled < d.quantity && (!c.company || d.company === c.company)).map(d => <option key={d.id} value={d.id}>{d.payload.date} · {d.quantity - d.settled}  {tr("pcs pending ·")} {d.payload.notes}</option>)}</select></label>}
 {kind === 'replacement' && <label>{tr("Replacement Recipient Company")}<select required value={c.targetCompany || c.company || ''} onChange={e => edit({ targetCompany: e.target.value })}><option value="">{tr("Select recipient")}</option>{data.companies.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select><button type="button" onClick={() => { onAction('order'); }}>{tr("Own stock unavailable? Choose Order from Outside in Movement")}</button></label>}
 {['dispatch', 'payment', 'settle', 'order', 'damage','return_receive'].includes(kind) && <label>{kind==='return_receive'?tr('Artisan work charge (₹)'):kind === 'dispatch' ? tr("Total Bill Amount (₹)") : tr("Amount / Cost (₹)")}<input type="number" min="0" step="0.01" value={c.amount ?? 0} onChange={e => edit({ amount: Number(e.target.value) })}/></label>}
 {kind === 'opening' && <label>{tr("Opening Due / Advance (₹, optional)")}<input type="number" step="0.01" value={c.openingDue ?? ''} onChange={e => edit({ openingDue: e.target.value === '' ? undefined : Number(e.target.value) })}/></label>}
 {kind==='order'&&<label>{tr("Replacement Product Category")}<select required value={c.product||''} onChange={e=>edit({product:e.target.value})}><option value="">{tr("Select product")}</option>{data.products.filter(p=>!p.office_only&&p.active).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
 {['settle', 'order'].includes(kind) && <label>{kind === 'settle' ? tr("Damage quantity being settled") : tr("Replacement quantity to order")}<input type="number" required min="1" step="1" value={c.reason || ''} onChange={e => edit({ reason: e.target.value })}/></label>}
 {kind === 'settle' && <label>{tr("Settlement Method")}<select value={c.settlement || ''} required onChange={e => edit({ settlement: e.target.value })}><option value="">{tr("Select method")}</option><option value="cash">{tr("Paid Separately — due unchanged")}</option><option value="due">{tr("Adjust from Company Due")}</option><option value="waived">{tr("Waived by Company")}</option></select></label>}
 {false && kind === 'stock_count' && <label>{tr("Difference")}<select value={c.reason || 'shortage'} onChange={e => edit({ reason: e.target.value })}><option value="shortage">{tr("Shortage — subtract")}</option><option value="surplus">{tr("Surplus — add")}</option></select></label>}
 {['dispute', 'damage'].includes(kind) && <><label>{tr("Identified Artist (optional)")}<select value={c.identifiedArtist || ''} onChange={e => edit({ identifiedArtist: e.target.value })}><option value="">{tr("Not identified")}</option>{data.artisans.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>{kind === 'dispute' && <label className="prod-check"><input type="checkbox" checked={!!c.factoryDamage} onChange={e => edit({ factoryDamage: e.target.checked })}/>{tr("Total damage — unusable, replacement / settlement required")}</label>}</>}
 <label>{tr("Remarks / Reason")}<textarea rows={3} value={c.notes || ''} onChange={e => edit({ notes: e.target.value })}/></label>
 {kind === 'opening' && <label className="prod-check"><input type="checkbox" checked={!!c.confirm} onChange={e => edit({ confirm: e.target.checked })}/>{tr("I reviewed this opening balance; this is not another receipt.")}</label>}
 {error && <p className="prod-error" role="alert">{tr(error)}</p>}<button className="prod-primary" type="submit">{busy ? tr("Saving / Checking…") : kind === 'opening' ? tr("Confirm Opening Balance") : (tr("Save ") + tr(actions[kind].label))}</button>
 </fieldset></form>;
}
function History({ data, company = '', defaultKind = '', defaultArtist = '', save }: {
    data: Snapshot;
    company?: string;
    defaultKind?: string;
    defaultArtist?: string;
    save: (c: Command, key: string) => Promise<unknown>;
}) {
    const {t:tr}=useInventoryLanguage();

    const [records, setRecords] = useState<Event[]>([]);
    const [page, setPage] = useState(0);
    const [more, setMore] = useState(false);
    const [kind, setKind] = useState(defaultKind);
    const [artist, setArtist] = useState(defaultArtist);
    const [filter, setFilter] = useState('');
    const [date, setDate] = useState('');
    const [editing, setEditing] = useState<Event>();
    const [quantities, setQuantities] = useState<number[]>([]);
    const [disputeQuantities, setDisputeQuantities] = useState<number[]>([]);
    const [amount, setAmount] = useState(0);const [editDate,setEditDate]=useState(today());const [editReference,setEditReference]=useState('');
    const semantic=(e:Event)=>e.payload.correctionKind||e.kind;
    const [reason, setReason] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const key = useRef('');
    useEffect(()=>{setKind(defaultKind);setArtist(defaultArtist);setPage(0);},[defaultKind,defaultArtist,company]);
    const params = new URLSearchParams({ company, date, search: filter, kind, artisan: artist, page: String(page) }).toString();
    useEffect(() => { let active = true; const timer = setTimeout(() => { void json('/api/production/records?' + params).then(r => { if (active) {
        setRecords(r.history);
        setMore(r.more);
        setError('');
    } }).catch(e => { if (active)
        setError(e.message); }); }, 200); return () => { active = false; clearTimeout(timer); }; }, [params, data.history]);
    const visible = records;
    async function download() { try {
        const result = await json('/api/production/records?' + params + '&export=true');
        const fields = ['date', 'action', 'bill', 'actor', 'remarks', 'lines'];
        const quote = (x: unknown) => { let s = String(x); if (/^[=+@-]/.test(s))
            s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
        const csv = [fields.join(','), ...result.history.map((e: Event) => [e.event_date, e.kind, e.reference, e.actor, e.notes, JSON.stringify(e.payload.lines || [])].map(quote).join(','))].join('\n');
        const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'tara-maa-history.csv';
        a.click();
        URL.revokeObjectURL(url);
    }
    catch (e) {
        setError((e as Error).message);
    } }
    return <section><div className="prod-fields"><label>{tr("Search History")}<input value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }} placeholder={tr("Artist, artwork, action, staff…")}/></label><label>{tr("Date")}<input type="date" value={date} onChange={e => { setDate(e.target.value); setPage(0); }}/></label></div><div className="prod-fields"><label>{tr("Action")}<select value={kind} onChange={e => { setKind(e.target.value); setPage(0); }}><option value="">{tr("All actions")}</option>{Object.entries(actions).map(([k, v]) => <option key={k} value={k}>{tr(v.label)}</option>)}</select></label><label>{tr("Artist")}<select value={artist} onChange={e => { setArtist(e.target.value); setPage(0); }}><option value="">{tr("All artists")}</option>{data.artisans.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label></div><button onClick={() => void download()}>{tr("Download matching history")}</button><button onClick={() => window.print()}>{tr("Print")}</button><p>{tr("50 records per page. Search applies to all history; exports include up to 10,000 matching records.")}</p>{visible.map(e => <article key={e.id} className="prod-history"><strong>{e.event_date} · {e.payload.correctionKind ? (tr("Correction · ") + tr(actions[e.payload.correctionKind]?.label||'')) : tr(actions[e.kind]?.label || e.kind)}{e.reversed ? tr(" · REVERSED / CORRECTED") : ''}</strong><p>{e.reference ? ((tr("Bill ") + e.reference) + ' · ') : ''}{e.actor} · {tr(e.actor_role)}</p><p>{e.notes}</p>{e.payload.identifiedArtist&&<p>{tr("Identified Artist:")} {data.artisans.find(a=>a.id===e.payload.identifiedArtist)?.name||tr('Not listed')}</p>}{e.payload.factoryDamage&&<p>{tr("Total Factory Damage")}</p>}{(e.payload.lines || []).map((l, i) => <p key={i}>{data.products.find(p => p.id === (l.source?.product || l.product))?.name} · {l.quantity}  {tr("pcs ·")} {l.source?.arts || ''}{l.artwork ? (' → ' + l.artwork) : ''}{l.preferred ? (tr(" · Preferred ") + l.preferred) : ''}{l.disputeQuantity !== undefined && <> · {tr('Ready to Dispatch')}: {l.quantity - l.disputeQuantity} · {tr('Repaint pending')}: {l.disputeQuantity}</>}</p>)}{e.payload.amount !== undefined && <p>{tr("Amount")} {money(Math.round(e.payload.amount * 100))}</p>}
 {!e.reversed && (((permitted(data.user.role,'officeEdit')&&semantic(e)==='office_vendor'&&(isManagement(data.user.role)||Date.now()-Date.parse(e.payload.originalCreatedAt||e.created_at)<864e5)))||(isManagement(data.user.role) && ['receipt', 'receive', 'return_receive', 'dispute', 'company_return', 'payment', 'dispatch', 'opening', 'stock_count'].includes(semantic(e))) || (['issue', 'additional', 'reprint', 'return_send'].includes(semantic(e)) && permitted(data.user.role, 'handoff') && (isManagement(data.user.role) || data.user.role === 'Supervisor' || (e.payload.originalActorId||e.actor_id)===data.user.id) && Date.now() - Date.parse(e.payload.originalCreatedAt||e.created_at) < 7 * 864e5)) && <button onClick={() => { setEditing(e);setEditDate(e.payload.date);setEditReference(e.reference||e.payload.reference||''); setQuantities((e.payload.lines || []).map(l => l.quantity));setDisputeQuantities((e.payload.lines || []).map(l => l.disputeQuantity || 0)); setAmount(e.payload.amount || 0); setReason(''); key.current = ''; }}>{tr("Correct entry")}</button>}
 {!e.reversed && isOwner(data.user.role) && ['receipt', 'issue', 'receive', 'dispatch', 'payment', 'opening', 'stock_count'].includes(semantic(e)) && <button onClick={async () => { const note = window.prompt(tr('Owner only: reason to delete / reverse this entry?')); if (!note)
            return; try {
            await save({ kind: 'delete', date: today(), document: e.id, notes: note }, crypto.randomUUID());
        }
        catch (err) {
            setError((err as Error).message);
        } }}>{tr("Delete / Reverse")}</button>}
 {editing?.id === e.id && <form onSubmit={async (ev) => { ev.preventDefault(); if (busy)
            return; setBusy(true); key.current ||= crypto.randomUUID(); try {
            await save({ kind: 'correct', date: editDate,reference:editReference, document: e.id, notes: reason, lines: (e.payload.lines || []).map((l, i) => ({ ...l, quantity: quantities[i], ...(l.disputeQuantity !== undefined ? {disputeQuantity: disputeQuantities[i]} : {}) })), amount }, key.current);
            setEditing(undefined);
        }
        catch (err) {
            setError((err as Error).message);
        }
        finally {
            setBusy(false);
        } }}><h3>{tr("Correct entry")}</h3><label>{tr("Entry date")}<input type="date" required value={editDate} onChange={ev=>{setEditDate(ev.target.value);key.current='';}}/></label><label>{tr("Bill / Challan No. (optional)")}<input value={editReference} onChange={ev=>{setEditReference(ev.target.value);key.current='';}}/></label>{semantic(e)!=='office_vendor'&&quantities.map((q, i) => <label key={i}>{tr("Line")} {(i + 1)}  {tr("quantity")}<input type="number" min="1" step="1" required value={q} onChange={ev => { setQuantities(x => x.map((n, j) => j === i ? Number(ev.target.value) : n)); key.current = ''; }}/></label>)}{semantic(e)==='receive'&&(e.payload.lines||[]).map((l,i)=>l.disputeQuantity!==undefined&&<label key={'dispute-'+i}>{tr('Line')} {i+1} · {tr('Dispute quantity')}<input type="number" min="0" max={quantities[i]} step="1" required value={disputeQuantities[i]??0} onChange={ev=>{setDisputeQuantities(x=>x.map((n,j)=>j===i?Number(ev.target.value):n));key.current='';}}/></label>)}{['dispatch', 'payment','receive','return_receive'].includes(semantic(e)) && <label>{tr("Amount (₹)")}<input type="number" min="0" step="0.01" value={amount} onChange={ev => { setAmount(Number(ev.target.value)); key.current = ''; }}/></label>}<label>{tr("Correction reason")}<input required value={reason} onChange={ev => { setReason(ev.target.value); key.current = ''; }}/></label><button disabled={busy}>{tr("Save correction")}</button><button type="button" onClick={() => setEditing(undefined)}>{tr("Cancel")}</button></form>}
 </article>)}{!visible.length && <p>{tr("No entries on this page.")}</p>}<div className="prod-actions"><button disabled={!page} onClick={() => setPage(page - 1)}>{tr("Previous")}</button><span>{tr("Page")} {(page + 1)}</span><button disabled={!more} onClick={() => setPage(page + 1)}>{tr("Next")}</button></div>{error && <p role="alert" className="prod-error">{tr(error)}</p>}</section>;
}
function Reports({ rows, company }: {
    rows: Balance[];
    company: string;
}) {
    const {t:tr}=useInventoryLanguage();
 const [report, setReport] = useState<{
    actions: {
        kind: string;
        quantity: number;
        entries: number;
    }[];
    days: {
        date: string;
        dispatched: number;
        paid: number;
    }[];
    payment_count: number;
    receipt_repaint?: number;
    average_payment_gap: number | null;
}>(); const [error, setError] = useState(''); useEffect(() => { let active = true; void json('/api/production/records?mode=reports&company=' + encodeURIComponent(company)).then(r => { if (active)
    setReport(r); }).catch(e => setError(e.message)); return () => { active = false; }; }, [company]); const stock = stages.map(stage => ({ stage, n: rows.filter(b => b.stage === stage).reduce((s, b) => s + b.quantity, 0) })).filter(x => x.n); const max = Math.max(1, ...stock.map(x => x.n)); const qty = (kind: string) => (report?.actions.find(a => a.kind === kind)?.quantity || 0) + (kind === 'reprint' ? report?.receipt_repaint || 0 : 0); return <section><h2>{tr("Current Stock Distribution")}</h2>{stock.map(x => <div className="prod-chart" key={x.stage}><span>{tr(labels[x.stage])}</span><meter min="0" max={max} value={x.n}/><b>{x.n}  {tr("pcs")}</b></div>)}{error && <p role="alert">{tr(error)}</p>}{report && <><h3>{tr("Work & Return Activity")}</h3><p>{tr("Internal reprint work:")} {qty('reprint')}  {tr("pcs · Company Returns:")} {qty('company_return')}  {tr("pcs · Dispatch occurrences:")} {qty('dispatch')}  {tr("pcs")}</p><p>{tr("Return occurrence rate:")} {qty('dispatch') ? ((100 * qty('company_return') / qty('dispatch')).toFixed(1) + '%') : tr("Not enough dispatch data")}{tr(". Repeated returns count as separate occurrences.")}</p><p>{tr("Internal rework occurrence rate:")} {qty('receive') ? ((100 * qty('reprint') / qty('receive')).toFixed(1) + '%') : tr("Not enough work received")}{tr(". Work quantities are not unique physical pieces.")}</p><h3>{tr("Dispatch Trend")}</h3>{report.days.filter(d => d.dispatched).map(d => <div className="prod-chart" key={d.date}><span>{d.date}</span><meter min="0" max={Math.max(1, ...report.days.map(d => d.dispatched))} value={d.dispatched}/><b>{d.dispatched}</b></div>)}<h3>{tr("Payment Frequency")}</h3><p>{report.payment_count}  {tr("payments · Average gap:")} {report.average_payment_gap === null ? tr("Not enough payments") : (report.average_payment_gap + tr(" days"))}</p>{report.days.filter(d => d.paid).map(d => <div className="prod-chart" key={d.date}><span>{d.date}</span><meter min="0" max={Math.max(1, ...report.days.map(d => d.paid))} value={d.paid}/><b>{money(d.paid * 100)}</b></div>)}</>}<p>{tr("Reports use all posted, effective history. Payments are not allocated to individual bills.")}</p></section>; }
function MasterForm({ type, data, close, saved, office=false }: {
    type: string;
    office?:boolean;
    data: Snapshot;
    close: () => void;
    saved: () => void;
}) {
    const {t:tr}=useInventoryLanguage();

    const [entity, id] = type.split(':');
    const newOwn=type==='company:own';
    const item = (entity === 'artisan' ? data.artisans : entity === 'company' ? data.companies : data.products).find(x => x.id === id);
    const [custom, setCustom] = useState('');
    const [works, setWorks] = useState<string[]>(item?.work_types || [item?.work_type || ''].filter(Boolean));
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const key = useRef('');
    return <div className="prod-overlay"><form className="prod-modal" onChange={() => { key.current = ''; }} onSubmit={async (e) => { e.preventDefault(); if (busy)
        return; setBusy(true); const values = Object.fromEntries(new FormData(e.currentTarget)); key.current ||= crypto.randomUUID(); try {
        await post('/api/production/masters', { ...values, kind: entity, id:newOwn?undefined:id, view:office?'office':'workshop', work_types: Array.from(new Set([...works, ...custom.split(',').map(x => x.trim()).filter(Boolean)])), key: key.current });
        saved();
    }
    catch (err) {
        setError((err as Error).message);
    }
    finally {
        setBusy(false);
    } }}><fieldset disabled={busy}><h2>{entity==='art_style'?tr('Create Art Style'):<>{id && !newOwn ? tr("Edit") : tr("Create")} {tr(entity)}</>}</h2><label>{tr("Name")}<input name="name" defaultValue={item?.name||(newOwn?'TaraFabbs Own Product':'')} required maxLength={120}/></label>{entity !== 'product' && entity !== 'art_style' && <><PhoneField key={id||"new"} name="contact" label={tr("Contact")} defaultValue={item?.contact}/><label>{tr("Address (optional)")}<textarea name="address" defaultValue={item?.address}/></label></>}{entity === 'artisan' && <><p>{tr("Artwork specializations — choose one or more")}</p>{artworkOptions(data,works).map(w => <label key={w} className="prod-check"><input type="checkbox" checked={works.includes(w)} onChange={e => { setWorks(e.target.checked ? [...works, w] : works.filter(x => x !== w)); key.current = ''; }}/>{w}</label>)}<label>{tr("Additional artwork names (separate with comma)")}<input value={custom} onChange={e => setCustom(e.target.value)} placeholder={tr("Your other artwork names")}/></label><p>{works.filter(w => !artisanWorkTypes.includes(w)).join(', ')}</p><label>{tr("Other work description")}<input name="work_description" defaultValue={item?.work_description}/></label>{id && <p>{tr("Identity fields are private. Leave blank to keep saved numbers; enter a new number to replace it.")}</p>}{['gst_no', 'pan_no', 'aadhaar_no'].map(f => <label key={f}>{tr(f.replaceAll('_', ' ').toUpperCase())}  {tr("(optional)")}<input name={f} autoComplete="off"/></label>)}</>}{entity === 'company' && (!id||newOwn) && !office && !isOfficeRole(data.user.role) && <label>{tr("Ownership")}<select name="ownership" defaultValue={newOwn?'OWN':'EXTERNAL'}><option value="EXTERNAL">{tr("Outside Company")}</option><option value="OWN">{tr("TaraFabbs Own")}</option></select></label>}{entity!=='art_style'&&<label>{tr("Remarks")}<textarea name="notes" defaultValue={item?.notes}/></label>}{error && <p role="alert" className="prod-error">{tr(error)}</p>}<button type="button" onClick={close}>{tr("Cancel")}</button><button className="prod-primary" disabled={busy}>{busy ? tr("Saving…") : tr(entity==='art_style'?'Save Art Style':'Save profile')}</button></fieldset></form></div>;
}
function OwnerControl({ data, save }: {
    data: Snapshot;
    save: (c: Command, key: string) => Promise<unknown>;
}) {
    const {t:tr}=useInventoryLanguage();
 const [reason, setReason] = useState(''); const [confirmed, setConfirmed] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [resetId, setResetId] = useState(''); const key = useRef(''); return <section><h2>{tr("Owner-only Quantity Reset")}</h2><p>{tr("Sets all current quantities to zero, including company-held and Office balances. Names, staff access, financial due and historical records stay preserved. Active damage/order records are archived. Restore is available for five hours before further stock entries.")}</p><form onSubmit={async (e) => { e.preventDefault(); if (busy)
    return; setBusy(true); key.current ||= crypto.randomUUID(); try {
    const r = await save({ kind: 'reset', date: today(), notes: reason, confirm: confirmed }, key.current) as {
        id: string;
    };
    setResetId(r.id);
}
catch (err) {
    setError((err as Error).message);
}
finally {
    setBusy(false);
} }}><label>{tr("Reset reason")}<input required value={reason} onChange={e => { setReason(e.target.value); key.current = ''; }}/></label><label className="prod-check"><input type="checkbox" checked={confirmed} onChange={e => { setConfirmed(e.target.checked); key.current = ''; }}/>{tr("I reviewed and want to reset all quantities.")}</label><button disabled={!confirmed || busy}>{tr("Reset quantities")}</button></form>{(resetId || data.history.find(e => e.kind === 'reset')?.id) && <button disabled={busy} onClick={async () => { setBusy(true); try {
    await save({ kind: 'undo_reset', date: today(), document: resetId || data.history.find(e => e.kind === 'reset')?.id, notes: 'Owner restored quantity reset' }, crypto.randomUUID());
    setResetId('');
}
catch (err) {
    setError((err as Error).message);
}
finally {
    setBusy(false);
} }}>{tr("Restore last reset")}</button>}{error && <p role="alert">{tr(error)}</p>}</section>; }

function ArtistSummary({artisan}:{artisan:string}){
    const {t:tr}=useInventoryLanguage();
const [data,setData]=useState<{given:number;received:number;last_activity:string}>();const [error,setError]=useState('');useEffect(()=>{let active=true;void json('/api/production/records?mode=artist&artisan='+encodeURIComponent(artisan)).then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[artisan]);return <section><h2>{tr("Artist Work History")}</h2>{data&&<><p>{tr("Total work issued:")} {data.given}  {tr("pcs · Received:")} {data.received}  {tr("pcs")}</p><p>{tr("Last activity:")} {data.last_activity||'No activity'}</p><p>{tr("These are work occurrences; the same product may pass through this artist more than once.")}</p></>}{error&&<p role="alert">{tr(error)}</p>}</section>;}
