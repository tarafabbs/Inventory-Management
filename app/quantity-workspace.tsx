'use client';

import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {ArrowDownLeft, ArrowUpRight, Building2, ChevronLeft, ClipboardList, Database, LayoutDashboard, MapPin, Menu, Package, Pencil, Phone, Plus, ShieldCheck, Store, Wrench, X} from 'lucide-react';
import {artisanWorkTypes, canEditOfficeEntry, isManagement, isOwner, permitted, roleLabel} from '@/lib/rules';
import {
  issueEditWindow, maxStockQuantity, needsDisputeReason, officeOperations, ownsOfficeTransfer,
  stageLabels, stockAvailable, stockOperations, trackedArtisan,
  type StockHistory, type StockMaster, type StockOperation, type StockSnapshot, type StockStage,
} from '@/lib/quantity-stock';
import SignOutButton from './sign-out-button';
import StaffManagement from './staff-management';
import AdminDataControl from './admin-data-control';
import OfficeCatalog from './office-catalog';
import './quantity-workspace.css';

const navigation = [
  ['dashboard', 'Company Dashboard', LayoutDashboard],
  ['receipt', 'New Entry', Plus],
  ['issue', 'Send to Artisan', ArrowUpRight],
  ['receive', 'Receive from Artisan', ArrowDownLeft],
  ['manage', 'Repair & Delivery', Wrench],
  ['history', 'History', ClipboardList],
  ['artisans','Artisan Dashboard',Building2],
] as const;
const officeNavigation = [
  ['dashboard','Office Inventory',Store],
  ['office-move','Office Movements',ArrowDownLeft],
  ['office-vendor','Office New Entry',Plus],
  ['history','Office History',ClipboardList],
  ['office-catalog','Office Records',Database],
] as const;
const managementNavigation = [
  ['staff','Staff Access',ShieldCheck],
  ['data','Data Control',Database],
] as const;
type Screen = typeof navigation[number][0] | typeof officeNavigation[number][0] | typeof managementNavigation[number][0];
type MovementScreen = 'receipt'|'issue'|'receive'|'manage'|'office-move'|'office-vendor';
type Save = (body: Record<string, unknown>, key: string) => Promise<void>;
type Masters = 'companies' | 'products' | 'thanwalas' | 'artisans';
const masterLabels = {companies: 'Company', products: 'Category', thanwalas: 'Thanwala', artisans: 'Artisan'};
const count = (value: number) => value.toLocaleString('en-IN');
const today = () => new Date().toLocaleDateString('en-CA', {timeZone: 'Asia/Kolkata'});
const editUntil = (row: StockHistory) => Date.parse(row.created_at) + issueEditWindow;
const name = (items: StockMaster[], id: string | null) => items.find(item => item.id === id)?.name || '—';
const movementLabel = (row: StockHistory) => row.kind === 'legacy' ? row.notes
  : row.kind === 'issue_edit' ? 'Handoff quantity edited' : row.kind==='office_entry_edit'
    ? 'Office entry corrected' : stockOperations[row.kind].label;

const extraOperations: StockOperation[] = [
  'dispatch', 'send_office','receive_factory_return','mark_repair', 'send_repair', 'receive_repaired', 'mark_dispute',
  'raw_dispute', 'repair_dispute', 'resolve_dispute', 'dispute_return', 'accept_pending',
];

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {...init, cache: 'no-store'});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The inventory request failed. Please try again.');
  return data;
}

export default function QuantityWorkspace({office = false}: {office?:boolean}) {
  const [data, setData] = useState<StockSnapshot | null>(null);
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [company, setCompany] = useState('');
  const [page, setPage] = useState(0);
  const [historyCompany, setHistoryCompany] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [adminBusy,setAdminBusy] = useState(false);
  const menu = useRef<HTMLDialogElement>(null);
  const latestRead = useRef(0);

  const refresh = useCallback(async (offset: number, filter: string) => {
    const request = ++latestRead.current;
    setLoading(true);
    setError('');
    try {
      const result = await requestJson('/api/quantity-stock?' + new URLSearchParams({page: String(offset), company: filter, view: office ? 'office' : 'workshop'}));
      if (request === latestRead.current) setData(result);
    } catch (error) {
      if (request === latestRead.current) setError(error instanceof Error ? error.message : 'Could not load stock.');
    } finally {
      if (request === latestRead.current) setLoading(false);
    }
  }, [office]);

  useEffect(() => {void refresh(page, historyCompany);}, [page, historyCompany, refresh]);

  const go = (next: Screen) => {
    menu.current?.close();
    setNotice('');
    setError('');
    setScreen(next);
  };

  const save: Save = async (body, key) => {
    await requestJson('/api/quantity-stock', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...body, key}),
    });
    setNotice('Saved. Company and artisan balances have been updated.');
    await refresh(page, historyCompany);
  };

  async function ledgerAction(operation: string, body: Record<string, unknown>) {
    return requestJson('/api/ledger', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({op:operation,key:crypto.randomUUID(),data:body}),
    });
  }

  async function adminAction(operation: string, body: Record<string, unknown>) {
    setAdminBusy(true);setError('');setNotice('');
    try {
      const result = await ledgerAction(operation,body);
      setNotice(result.message || 'Data Control change saved.');
      await refresh(page,historyCompany);
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save Data Control change.');
      return null;
    } finally {
      setAdminBusy(false);
    }
  }

  async function addMaster(kind: Masters, entryName: string, workType: string, description: string, ownership: string) {
    const result = await requestJson('/api/ledger', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({op: office ? 'officeMasterCreate' : 'master', key: crypto.randomUUID(), data: {
        kind, name: entryName, ...(kind === 'companies' ? {ownership} : {}),
        ...(kind === 'artisans' ? {work_type: workType, work_description: description} : {}),
      }}),
    });
    await refresh(page, historyCompany);
    return result.id as string;
  }

  const role = data?.user.role || '';
  const shownTabs = [...(office ? officeNavigation : navigation), ...managementNavigation].filter(([key]) => (
    key === 'staff' ? isOwner(role) :
    key === 'data' ? permitted(role,'manageData') :
    key === 'office-vendor' ? permitted(role,'officeEntry') :
    key === 'office-catalog' ? permitted(role,'officeMaster') :
    key === 'office-move' ? permitted(role,'officeReceive') :
    key === 'receipt' ? permitted(role,'receipt') :
    key === 'issue' ? permitted(role,'handoff') :
    key === 'receive' ? permitted(role,'return') :
    key === 'manage' ? extraOperations.some(operation => permitted(role, stockOperations[operation].permission)) : true
  ));

  return <div className="qty-app">
    <header className="qty-header">
      <div className="qty-brand"><button type="button" className="qty-menu-button" aria-label="Open side menu" aria-haspopup="dialog" onClick={() => menu.current?.showModal()}><Menu size={22}/></button>
        <div><strong>IMS TARA MAA</strong><small>{office ? 'Office inventory' : 'Workshop stock'}</small></div></div>
      {data && <div className="qty-account"><span>{data.user.name} · {roleLabel(role)}</span></div>}
    </header>
    <dialog className="qty-menu" ref={menu} aria-labelledby="qty-menu-title" onClick={event => {if(event.target===event.currentTarget)menu.current?.close();}}>
      <div className="qty-menu-body">
        <header><div><strong id="qty-menu-title">IMS TARA MAA</strong><small>{data ? `${data.user.name} · ${roleLabel(role)}` : 'Inventory workspace'}</small></div>
          <button type="button" aria-label="Close side menu" onClick={() => menu.current?.close()}><X size={19}/></button></header>
        <nav aria-label="Side menu">
          {shownTabs.map(([key,label,Icon]) => <button type="button" key={key} aria-current={screen===key ? 'page' : undefined} onClick={() => go(key)}><Icon size={18}/>{label}</button>)}
          {isManagement(role) && <a href={office ? '/' : '/?view=Office'}>{office ? <Package size={18}/> : <Store size={18}/>}
            {office ? 'Workshop stock' : 'Office inventory'}</a>}
        </nav>
        <footer><SignOutButton/></footer>
      </div>
    </dialog>
    <nav className="qty-nav" aria-label="Inventory navigation">
      {shownTabs.filter(([key]) => key!=='staff' && key!=='data').map(([key,label,Icon]) => <button type="button" key={key} aria-current={screen === key ? 'page' : undefined} onClick={() => go(key)}><Icon size={18}/>{label}</button>)}
    </nav>
    <main className="qty-main" aria-busy={loading}>
      {error && <p className="qty-status bad" role="alert">{error} <button type="button" onClick={() => void refresh(page, historyCompany)}>Reload stock</button></p>}
      {notice && <p className="qty-status" role="status">{notice}</p>}
      {!data && !error && <p role="status">Loading stock…</p>}
      {data && screen === 'artisans' && <ArtisanDashboard data={data} create={async values=>{
        const result=await ledgerAction('artisanCreate',values);
        await refresh(page,historyCompany);
        setNotice('Artisan created. The profile and artwork options are updated.');
        return result.id;
      }}/>}
      {data && screen === 'dashboard' && (office
        ? <OfficeDashboard data={data} company={company} setCompany={setCompany} onAction={go}/>
        : <Dashboard data={data} company={company} setCompany={id => {setCompany(id);setPage(0);setHistoryCompany(id);}} onAction={go}
          onSave={async (body,key) => {
            await requestJson('/api/quantity-stock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,kind:'company_profile_edit',key})});
            setNotice('Company profile updated. The new details now appear across the inventory.');
            await refresh(0,String(body.id||''));
          }}/>) }
      {data && ['receipt','issue','receive','manage','office-move','office-vendor'].includes(screen) && <MovementForm key={screen} screen={screen as MovementScreen}
        data={data} initialCompany={company} save={save} addMaster={addMaster} loading={loading}/>}
      {data && screen === 'history' && <History data={data} page={page} setPage={setPage} company={historyCompany} setCompany={id => {setPage(0);setHistoryCompany(id);}}
        loading={loading} save={save} office={office}/>}
      {data && screen === 'staff' && isOwner(role) && <StaffManagement currentUser={data.user.id} request={requestJson} save={values => ledgerAction('user',values)}/>}
      {data && screen === 'office-catalog' && permitted(role,'officeMaster') && <OfficeCatalog request={requestJson}
        save={async values=>{await ledgerAction('officeMasterEdit',values);await refresh(page,historyCompany);}}/>}
      {data && screen === 'data' && permitted(role,'manageData') && <AdminDataControl action={adminAction} busy={adminBusy} canDelete={isOwner(role)}/>}
    </main>
  </div>;
}

function Dashboard({data, company, setCompany, onAction,onSave}: {
  data: StockSnapshot; company: string; setCompany: (id: string) => void; onAction: (screen: Screen) => void;onSave:Save;
}) {
  const selected=data.companies.find(item=>item.id===company);
  const [editing,setEditing]=useState(false);
  if (!selected) return <>
    <div className="qty-title"><div><h1>Company Dashboard</h1><p>Open a company profile to view its stock and records.</p></div></div>
    <div className="qty-category-grid">{data.companies.map(item=>{
      const balances=data.balances.filter(row=>row.company_id===item.id);
      return <section className="qty-category" key={item.id}><header><div><small>{item.ownership==='OWN'?'Own Product':'Jobwork company'}</small><h2>{item.name}</h2></div></header>
        {item.contact&&<p>{item.contact}</p>}
        <p>Raw stock <b>{count(balances.filter(row=>row.stage==='raw').reduce((n,row)=>n+row.quantity,0))} pcs</b></p>
        <p>With artisans <b>{count(balances.filter(row=>row.stage==='artisan'||row.stage==='repair_artisan').reduce((n,row)=>n+row.quantity,0))} pcs</b></p>
        <button type="button" onClick={()=>{setEditing(false);setCompany(item.id);}}>Open profile</button></section>;
    })}</div>
  </>;
  const lookup = new Map<string, {company: string; product: string; stages: Partial<Record<StockStage,number>>; received: number; issued: number; artistReturns: number}>();
  function rowFor(company: string, product: string) {
    const key = JSON.stringify([company,product]);
    let row = lookup.get(key);
    if (!row) {
      row = {company, product, stages: {}, received: 0, issued: 0, artistReturns: 0};
      lookup.set(key,row);
    }
    return row;
  }
  for (const row of data.balances) {
    if (company && row.company_id !== company) continue;
    const entry = rowFor(row.company_id,row.product_id);
    entry.stages[row.stage] = (entry.stages[row.stage] || 0) + row.quantity;
  }
  for (const row of data.totals) {
    if (company && row.company_id !== company) continue;
    Object.assign(rowFor(row.company_id,row.product_id), {received: row.received, issued: row.issued, artistReturns: row.artist_returns});
  }
  const rows = Array.from(lookup.values()).sort((a,b) =>
    name(data.companies,a.company).localeCompare(name(data.companies,b.company)) || name(data.products,a.product).localeCompare(name(data.products,b.product)));
  const due = (row: typeof rows[number]) => Math.max(0, row.received - (row.stages.delivered || 0) - (row.stages.dispute_returned || 0));
  const sumStage = (stage: StockStage) => rows.reduce((total,row) => total + (row.stages[stage] || 0),0);
  const cards = [
    ['Raw stock', sumStage('raw')],
    ['With artisans', sumStage('artisan')],
    ['Ready for company', sumStage('ready')],
    ['Still due to companies', rows.filter(row => data.companies.find(c => c.id === row.company)?.ownership === 'EXTERNAL').reduce((sum,row) => sum + due(row),0)],
  ] as const;
  return <>
    <button type="button" onClick={()=>{setEditing(false);setCompany('');}}><ChevronLeft size={17}/>All companies</button>
    <section className="qty-panel qty-staff-form"><h1>{selected.name}</h1>
      {selected.contact&&<p><Phone size={15}/> {selected.contact}</p>}
      {selected.address&&<p><MapPin size={15}/> {selected.address}</p>}
      {selected.notes&&<p>{selected.notes}</p>}
      {permitted(data.user.role,'manageData')&&<button type="button" onClick={()=>setEditing(value=>!value)}><Pencil size={16}/>Edit company details</button>}
      {editing&&<CompanyEditor key={selected.id} company={selected} save={onSave} close={()=>setEditing(false)}/>}
    </section>
    <div className="qty-title"><div><h1>Company Dashboard</h1><p>Stock balances by company and product category.</p></div>
      <label className="qty-field compact"><span>Company</span><select value={company} onChange={event => setCompany(event.target.value)}>
        <option value="">All companies</option>{data.companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label></div>
    <div className="qty-cards">{cards.map(([label,quantity]) => <div key={label}><span>{label}</span><strong>{count(quantity)} <small>pcs</small></strong></div>)}</div>
    <div className="qty-quick">
      {permitted(data.user.role,'receipt') && <button className="qty-primary" onClick={() => onAction('receipt')}><Plus size={17}/>New Entry</button>}
      {permitted(data.user.role,'handoff') && <button onClick={() => onAction('issue')}><ArrowUpRight size={17}/>Send to artisan</button>}
      {permitted(data.user.role,'return') && <button onClick={() => onAction('receive')}><ArrowDownLeft size={17}/>Receive stock</button>}
    </div>
    {!rows.length && <p className="qty-empty">No stock has been recorded for this selection.</p>}
    <div className="qty-category-grid">{rows.map(row => {
      const stage = row.stages;
      const external = data.companies.find(item => item.id === row.company)?.ownership === 'EXTERNAL';
      return <section className="qty-category" key={JSON.stringify([row.company,row.product])}>
        <header><div><small>{name(data.companies,row.company)}</small><h2>{name(data.products,row.product)}</h2></div>
          {external && <span className="qty-due">{count(due(row))} pcs due</span>}</header>
        <dl>{[
          ['Total received',row.received], ['Raw stock',stage.raw], ['Sent to artisans',row.issued],
          ['With artisans now',stage.artisan], ['Received from artisans',row.artistReturns],
          ['Ready for company',stage.ready], ['Waiting for repair',stage.repair], ['Out for repair',stage.repair_artisan],
          ['Disputed in stock',stage.disputed], ['Dispute returned to company',stage.dispute_returned],
          ['Delivered to company',stage.delivered],
          ...((stage.pending || stage.review) ? [['Legacy stock to review',(stage.pending || 0)+(stage.review || 0)]] : []),
          ...((stage.office_pending || stage.office_stock || stage.office_sold)
            ? [['Transferred to Office',(stage.office_pending || 0)+(stage.office_stock || 0)+(stage.office_sold || 0)]] : []),
          ...(stage.factory_return_pending ? [['Awaiting workshop receipt',stage.factory_return_pending]] : []),
        ].map(([label,quantity]) => <div key={label}><dt>{label}</dt><dd>{count(Number(quantity || 0))}</dd></div>)}</dl>
      </section>;
    })}</div>
    {data.balances.some(row => (!company || row.company_id === company) && row.quantity > 0 && row.artisan_id) &&
      <section className="qty-panel qty-outstanding"><h2>Stock with artisans</h2><ul>{data.balances
        .filter(row => (!company || row.company_id === company) && row.quantity > 0 && row.artisan_id)
        .map(row => <li key={JSON.stringify([row.company_id,row.product_id,row.artisan_id,row.stage])}>
          <span><strong>{name(data.artisans,row.artisan_id)}</strong><small>{name(data.companies,row.company_id)} · {name(data.products,row.product_id)}{row.stage === 'repair_artisan' ? ' · Repair' : ''}</small></span>
          <b>{count(row.quantity)} pcs</b></li>)}</ul></section>}
    <CompanyHistory company={company}/>
  </>;
}

function CompanyEditor({company,save,close}:{company:StockMaster;save:Save;close:()=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const key=useRef('');
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy)return;
    const values=Object.fromEntries(new FormData(event.currentTarget));setBusy(true);setError('');
    key.current ||= crypto.randomUUID();
    try {await save({id:company.id,...values,expected:{name:company.name,contact:company.contact||'',address:company.address||'',notes:company.notes||''}},key.current);close();}
    catch(cause){setError(cause instanceof Error?cause.message:'Unable to save company.');}
    finally{setBusy(false);}
  }
  return <form className="qty-form" onSubmit={submit} onChange={()=>{key.current='';}}><fieldset disabled={busy}>
    {(['name','contact','address','notes'] as const).map(field=><label className="qty-field" key={field}><span>{field[0].toUpperCase()+field.slice(1)}</span>
      <input name={field} required={field==='name'} maxLength={field==='name'?120:field==='contact'?300:field==='notes'?2000:1000} defaultValue={company[field]||''}/></label>)}
    {error&&<p role="alert" className="qty-status bad">{error}</p>}
    <button className="qty-primary" type="submit">{busy?'Saving…':'Save company'}</button>
  </fieldset></form>;
}

function CompanyHistory({company,artisan}:{company?:string;artisan?:string}) {
  const [data,setData]=useState<StockSnapshot|null>(null),[page,setPage]=useState(0),[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    requestJson('/api/quantity-stock?'+new URLSearchParams({company:company||'',artisan:artisan||'',page:String(page)}),{signal:controller.signal})
      .then(result=>setData(result)).catch(cause=>{if(!controller.signal.aborted)setError(cause.message);});
    return()=>controller.abort();
  },[company,artisan,page]);
  return <section className="qty-panel qty-history qty-outstanding"><h2>Movement history</h2>
    {error&&<p role="alert">{error}</p>}
    <ul>{data?.history.map(row=><li key={row.id}><strong>{movementLabel(row)} · {count(row.quantity)} pcs</strong>
      <small>{name(data.companies,row.company_id)} · {name(data.products,row.product_id)} · {row.actor} · {new Date(row.created_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</small></li>)}</ul>
    <footer><button disabled={!page} onClick={()=>setPage(page-1)}>Previous</button><span>Page {page+1}</span><button disabled={!data?.more} onClick={()=>setPage(page+1)}>Next</button></footer>
  </section>;
}

function ArtisanDashboard({data,create}:{data:StockSnapshot;create:(values:Record<string,unknown>)=>Promise<string>}) {
  const [selected,setSelected]=useState('');
  const [creating,setCreating]=useState(false);
  const creator=<>{permitted(data.user.role,'masterCreate')&&<button type="button" className="qty-primary" onClick={()=>setCreating(true)}><Plus size={17}/>Create artisan</button>}
    {creating&&<ArtisanCreator artisans={data.artisans} create={create} close={()=>setCreating(false)} onCreated={id=>{setSelected(id);setCreating(false);}}/>}</>;
  const artisan=data.artisans.find(row=>row.id===selected);
  const balance=data.balances.filter(row=>row.artisan_id===selected&&row.quantity>0);
  if (!artisan) return <><div className="qty-title"><div><h1>Artisan Dashboard</h1><p>Open an artisan profile to review outstanding stock and movements.</p></div></div>{creator}
    <div className="qty-category-grid">{data.artisans.map(row=><section className="qty-category" key={row.id}><h2>{row.name}</h2>
      <p>Outstanding <b>{count(data.balances.filter(b=>b.artisan_id===row.id).reduce((sum,b)=>sum+b.quantity,0))} pcs</b></p>
      <button type="button" onClick={()=>setSelected(row.id)}>Open profile</button></section>)}</div></>;
  return <><button onClick={()=>setSelected('')}><ChevronLeft size={17}/>All artisans</button>
    <div className="qty-title"><h1>{artisan.name}</h1></div>{creator}
    <div className="qty-category-grid">{balance.map(row=><section className="qty-category" key={JSON.stringify(row)}>
      <small>{name(data.companies,row.company_id)}</small><h2>{name(data.products,row.product_id)}</h2>
      <p>{stageLabels[row.stage]} <b>{count(row.quantity)} pcs</b></p></section>)}</div>
    {!balance.length&&<p className="qty-empty">No outstanding stock with this artisan.</p>}
    <CompanyHistory key={selected} artisan={selected}/></>;
}

function ArtisanCreator({artisans,create,close,onCreated}:{
  artisans:StockMaster[];create:(values:Record<string,unknown>)=>Promise<string>;close:()=>void;onCreated:(id:string)=>void;
}) {
  const [work,setWork]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const pending=useRef(false);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(pending.current)return;
    const values=Object.fromEntries(new FormData(event.currentTarget));
    if(artisans.some(row=>row.name.trim().toLowerCase()===String(values.name).trim().toLowerCase())){
      setError('This artisan is already listed. Open their profile.');return;
    }
    pending.current=true;setBusy(true);setError('');
    try{onCreated(await create(values));}
    catch(cause){setError(cause instanceof Error?cause.message:'Unable to create artisan.');}
    finally{pending.current=false;setBusy(false);}
  }
  return <form className="qty-panel qty-form qty-staff-form" onSubmit={submit}><fieldset disabled={busy}>
    <h2>Create artisan</h2><div className="qty-fields">
      <label className="qty-field"><span>Artisan name</span><input name="name" autoFocus required maxLength={120}/></label>
      <label className="qty-field"><span>Contact (optional)</span><input name="contact" type="tel" maxLength={200}/></label>
      <label className="qty-field"><span>Artwork / work type</span><select name="work_type" required value={work} onChange={event=>setWork(event.target.value)}>
        <option value="">Select artwork</option>{artisanWorkTypes.map(type=><option key={type}>{type}</option>)}</select></label>
    </div>
    {work==='Others'&&<label className="qty-field"><span>Work description</span><input name="work_description" required maxLength={300}/></label>}
    <label className="qty-field"><span>Address (optional)</span><textarea name="address" maxLength={1000} rows={2}/></label>
    <div className="qty-fields">
      <label className="qty-field"><span>GST No. (optional)</span><input name="gst_no" maxLength={15} autoCapitalize="characters"/></label>
      <label className="qty-field"><span>PAN (optional)</span><input name="pan_no" maxLength={10} autoCapitalize="characters"/></label>
      <label className="qty-field"><span>Aadhaar (optional)</span><input name="aadhaar_no" inputMode="numeric" maxLength={14} autoComplete="off"/></label>
    </div>
    {error&&<p role="alert" className="qty-status bad">{error}</p>}
    <div className="qty-quick"><button type="button" onClick={close}>Cancel</button><button className="qty-primary" type="submit">{busy?'Creating…':'Create artisan'}</button></div>
  </fieldset></form>;
}

function OfficeDashboard({data,company,setCompany,onAction}: {
  data: StockSnapshot; company: string; setCompany: (id:string) => void; onAction: (screen:Screen) => void;
}) {
  const stages = ['office_pending','office_stock','office_sold','factory_return_pending'] as const;
  const balances = data.balances.filter(row => !company || row.company_id === company);
  const groups = new Map<string,{companyId:string; productId:string; stages:Partial<Record<StockStage,number>>}>();
  for (const balance of balances) {
    const id=JSON.stringify([balance.company_id,balance.product_id]);
    const row=groups.get(id) || {companyId:balance.company_id,productId:balance.product_id,stages:{}};
    row.stages[balance.stage]=balance.quantity;
    groups.set(id,row);
  }
  return <>
    <div className="qty-title"><div><h1>Office Inventory</h1><p>Workshop receipts, office stock, sales and returns.</p></div>
      <label className="qty-field compact"><span>Company / vendor</span><select value={company} onChange={event=>setCompany(event.target.value)}>
        <option value="">All companies</option>{data.companies.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label></div>
    <div className="qty-cards">{stages.map(stage=><div key={stage}><span>{stageLabels[stage]}</span><strong>{count(balances.filter(row=>row.stage===stage).reduce((sum,row)=>sum+row.quantity,0))} <small>pcs</small></strong></div>)}</div>
    <div className="qty-quick">
      <button type="button" className="qty-primary" onClick={()=>onAction('office-move')}><ArrowDownLeft size={17}/>Office Movements</button>
      {permitted(data.user.role,'officeEntry') && <button type="button" onClick={()=>onAction('office-vendor')}><Plus size={17}/>Office New Entry</button>}
    </div>
    {!groups.size && <p className="qty-empty">No stock has been sent to Office for this selection.</p>}
    <div className="qty-category-grid">{Array.from(groups.entries()).map(([id,row])=><section className="qty-category" key={id}>
      <header><div><small>{name(data.companies,row.companyId)}</small><h2>{name(data.products,row.productId)}</h2></div></header>
      <dl>{[...stages,...(row.stages.office_vendor_pending ? ['office_vendor_pending' as const] : [])].map(stage=><div key={stage}>
        <dt>{stageLabels[stage]}</dt><dd>{count(row.stages[stage] || 0)}</dd></div>)}</dl>
    </section>)}</div>
  </>;
}

function MovementForm({screen,data,initialCompany,save,addMaster,loading}: {
  screen: MovementScreen; data: StockSnapshot; initialCompany: string;
  save: Save; addMaster: (kind: Masters, name: string, workType: string, description: string, ownership: string) => Promise<string>; loading: boolean;
}) {
  const officeMove = screen === 'office-move';
  const choices = (officeMove ? officeOperations.filter(key => key !== 'office_vendor_receipt') : extraOperations)
    .filter(key => permitted(data.user.role,stockOperations[key].permission));
  const [kind,setKind] = useState<StockOperation>(() => {
    if (officeMove) return choices[0] || 'office_receive';
    if (screen === 'office-vendor') return 'office_vendor_receipt';
    if (screen === 'manage') return choices[0] || 'dispatch';
    return screen;
  });
  const [company,setCompany] = useState(initialCompany);
  const [product,setProduct] = useState('');
  const [artisan,setArtisan] = useState('');
  const [thanwala,setThanwala] = useState('');
  const [quantity,setQuantity] = useState('');
  const [date,setDate] = useState(today);
  const [reference,setReference] = useState('');
  const [notes,setNotes] = useState('');
  const [preferredWork,setPreferredWork]=useState('');
  const preferredWorks=Array.from(new Set(data.artisans.filter(row=>row.active && row.work_type?.trim()).map(row=>row.work_type!.trim()))).sort();
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState('');
  const [newMaster,setNewMaster] = useState<Masters | null>(null);
  const [masterName,setMasterName] = useState('');
  const [workType,setWorkType] = useState('');
  const [workDescription,setWorkDescription] = useState('');
  const [ownership,setOwnership] = useState('EXTERNAL');
  const key = useRef('');
  const savingRef = useRef(false);
  const operation = stockOperations[kind];
  const needsArtisan = Boolean(trackedArtisan(operation.from,'yes') || trackedArtisan(operation.to,'yes'));
  const countInStock = stockAvailable(data.balances,company,product,operation.from,artisan || null);
  const number = Number(quantity);
  const hasQuantity = Number.isInteger(number) && number > 0 && number <= maxStockQuantity;
  const exceed = operation.from !== null && number > countInStock;
  const own = data.companies.find(item => item.id === company)?.ownership === 'OWN';
  const reasonRequired = needsDisputeReason(kind);
  const vendor = kind === 'office_vendor_receipt';
  const isReceipt = kind === 'receipt' || vendor;
  const canCreate = vendor ? permitted(data.user.role,'officeMaster') : kind === 'receipt' && permitted(data.user.role,'masterCreate');
  const canCreateArtisan = ['issue','send_repair'].includes(kind) && permitted(data.user.role,'masterCreate');
  const validMaster = masterName.trim() && (newMaster !== 'artisans'
    || (workType && (workType !== 'Others' || workDescription.trim())));
  const inStock = (companyId: string, productId?: string) => data.balances.some(row => row.company_id === companyId
    && (!productId || row.product_id === productId) && row.stage === operation.from && row.quantity > 0);
  const companies = data.companies.filter(item => (kind !== 'dispatch' || item.ownership === 'EXTERNAL')
    && (!ownsOfficeTransfer(kind) || item.ownership === 'OWN')
    && (isReceipt ? item.active && (vendor ? item.office_only === 1 : !item.office_only) : inStock(item.id)));
  const products = data.products.filter(item => isReceipt
    ? item.active && (vendor ? item.office_only === 1 : !item.office_only) : inStock(company,item.id));
  const artisans = data.artisans.filter(item => trackedArtisan(operation.from,item.id)
    ? stockAvailable(data.balances,company,product,operation.from,item.id) > 0 : item.active);
  const valid = companies.some(item => item.id === company) && products.some(item => item.id === product) && hasQuantity
    && (!needsArtisan || artisans.some(item => item.id === artisan)) && !exceed
    && (!reasonRequired || notes.trim().length > 0) && (!own || kind !== 'receipt' || Boolean(thanwala));
  const changed = () => {key.current = '';setError('');};

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || savingRef.current || loading || newMaster) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    key.current ||= crypto.randomUUID();
    try {
      await save({kind,companyId:company,productId:product,artisanId:artisan,thanwalaId:thanwala,
        quantity:number,receivedOn:date,reference,notes,preferredWork}, key.current);
      setQuantity('');setReference('');setNotes('');setPreferredWork('');key.current = '';
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to save stock.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function create() {
    if (!newMaster || !validMaster || savingRef.current) return;
    if (data[newMaster].some(item => item.name.trim().toLowerCase() === masterName.trim().toLowerCase())) {
      setError('This name is already saved. Select it from the list.');return;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const id = await addMaster(newMaster,masterName.trim(),workType,workDescription.trim(),ownership);
      if (newMaster === 'companies') {setCompany(id);setThanwala('');}
      if (newMaster === 'products') setProduct(id);
      if (newMaster === 'thanwalas') setThanwala(id);
      if (newMaster === 'artisans') setArtisan(id);
      setNewMaster(null);setMasterName('');changed();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to create the record.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const createButton = (kind: Masters) => (kind === 'artisans' ? canCreateArtisan : canCreate)
    && <button type="button" className="qty-small" onClick={() => {setNewMaster(kind);setMasterName('');setWorkType('');setWorkDescription('');setOwnership('EXTERNAL');setError('');}}><Plus size={15}/>Add {vendor && kind==='companies' ? 'vendor' : masterLabels[kind].toLowerCase()}</button>;
  return <div className="qty-work">
    <div className="qty-title"><div><h1>{screen === 'manage' ? 'Repair & Delivery' : officeMove ? 'Office Movements' : stockOperations[kind].label}</h1>
      <p>{screen === 'receipt' ? 'Add received pieces to raw stock.' : screen === 'issue' ? 'Choose a company, category and artisan to issue raw stock.'
        : screen === 'receive' ? 'Record returned work in its own stock balance.' : officeMove ? 'Receive from the workshop, mark sales, or send disputed Own Products back.'
        : vendor ? 'Enter the pieces received from an outside vendor.' : 'Record repair, disputes and delivery against the company’s balance.'}</p></div></div>
    <form className="qty-panel qty-form" onSubmit={submit}>
      <fieldset disabled={saving || loading}>
        {(screen === 'manage' || screen === 'receive' || officeMove) && <label className="qty-field"><span>{screen === 'receive' ? 'Return status' : 'Action'}</span><select value={kind} onChange={event => {setKind(event.target.value as StockOperation);setProduct('');setArtisan('');setQuantity('');setNotes('');changed();}}>
          {(screen === 'receive' ? ['receive','receive_repair','receive_dispute'] as const : choices).map(key =>
            <option key={key} value={key}>{screen === 'receive' ? ({receive:'Ready for company',receive_repair:'Needs repair',receive_dispute:'Disputed'} as Record<string,string>)[key] : stockOperations[key].label}</option>)}
        </select></label>}
        <div className="qty-fields">
          <div><label className="qty-field"><span>{vendor ? 'Outside vendor' : 'Company / party'}</span><select value={company} required onChange={event => {setCompany(event.target.value);setProduct('');setArtisan('');setThanwala('');changed();}}>
            <option value="">Select company</option>{companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>{createButton('companies')}</div>
          <div><label className="qty-field"><span>Product category</span><select required value={product} onChange={event => {setProduct(event.target.value);setArtisan('');changed();}}>
            <option value="">Select category</option>{products.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>{createButton('products')}</div>
          {needsArtisan && <div><label className="qty-field"><span>Artisan</span><select required value={artisan} onChange={event => {setArtisan(event.target.value);changed();}}>
            <option value="">Select artisan</option>{artisans.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>{createButton('artisans')}</div>}
          {own && kind === 'receipt' && <div><label className="qty-field"><span>Purchase Thanwala</span><select required value={thanwala} onChange={event => {setThanwala(event.target.value);changed();}}>
            <option value="">Select Thanwala</option>{data.thanwalas.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>{createButton('thanwalas')}</div>}
        </div>
        {newMaster && <div className="qty-inline">
          <label className="qty-field"><span>{masterLabels[newMaster]} name</span><input autoFocus maxLength={120} value={masterName} onChange={event => setMasterName(event.target.value)} onKeyDown={event => {if (event.key === 'Enter') {event.preventDefault();void create();}}}/></label>
          {newMaster === 'companies' && !vendor && <label className="qty-field"><span>Source type</span><select value={ownership} onChange={event => setOwnership(event.target.value)}>
            <option value="EXTERNAL">Jobwork company</option><option value="OWN">TaraFabbs Own Product</option>
          </select></label>}
          {newMaster === 'artisans' && <label className="qty-field"><span>Work type</span><select value={workType} onChange={event => setWorkType(event.target.value)}>
            <option value="">Select work type</option>{artisanWorkTypes.map(type => <option key={type}>{type}</option>)}
          </select></label>}
          {newMaster === 'artisans' && workType === 'Others' && <label className="qty-field"><span>Work description</span><input value={workDescription} maxLength={300} onChange={event => setWorkDescription(event.target.value)}/></label>}
          <button type="button" onClick={() => setNewMaster(null)}>Cancel</button>
          <button type="button" className="qty-primary" disabled={!validMaster} onClick={() => void create()}>Add & select</button>
        </div>}
        {!companies.length && !isReceipt && <p className="qty-empty">No company has stock available for this action.</p>}
        <div className="qty-fields">
          {operation.from && <div className="qty-figure"><span>{stageLabels[operation.from]} available</span><strong>{count(countInStock)} pcs</strong></div>}
          <label className="qty-field"><span>Quantity (pcs)</span><input required inputMode="numeric" type="number" min={1} max={maxStockQuantity} step={1} value={quantity} placeholder="0" onChange={event => {setQuantity(event.target.value);changed();}}/></label>
          {operation.from && <div className={'qty-figure ' + (exceed ? 'bad' : '')} aria-live="polite"><span>Balance after saving</span><strong>{exceed ? 'Insufficient stock' : `${count(countInStock - (hasQuantity ? number : 0))} pcs`}</strong></div>}
        </div>
        {kind==='receipt'&&<label className="qty-field"><span>Preferred work (optional)</span><select value={preferredWork} onChange={event=>{setPreferredWork(event.target.value);changed();}}>
          <option value="">No preference</option>{preferredWorks.map(work=><option key={work} value={work}>{work}</option>)}
        </select></label>}
        {isReceipt && <div className="qty-fields">
          <label className="qty-field"><span>Arrival date</span><input type="date" required value={date} onChange={event => {setDate(event.target.value);changed();}}/></label>
          <label className="qty-field"><span>Bill / challan (optional)</span><input maxLength={200} value={reference} onChange={event => {setReference(event.target.value);changed();}}/></label>
        </div>}
        <label className="qty-field"><span>{reasonRequired ? 'Dispute reason' : 'Notes (optional)'}</span><textarea rows={2} maxLength={1000} value={notes} required={reasonRequired} onChange={event => {setNotes(event.target.value);changed();}}/></label>
        {error && <p className="qty-status bad" role="alert">{error}</p>}
        <button className="qty-primary" type="submit" disabled={!valid || Boolean(newMaster)}>{saving ? 'Saving…' : hasQuantity ? `Save ${count(number)} pcs` : 'Save entry'}</button>
      </fieldset>
    </form>
  </div>;
}

function History({data,page,setPage,company,setCompany,loading,save,office}: {
  data: StockSnapshot; page: number; setPage: (page: number) => void; company: string; setCompany: (id: string) => void;
  loading: boolean; save: Save; office: boolean;
}) {
  const [editing,setEditing] = useState<StockHistory | null>(null);
  const [officeEdit,setOfficeEdit] = useState<StockHistory|null>(null);
  const [quantity,setQuantity] = useState('');
  const [error,setError] = useState('');
  const [saving,setSaving] = useState(false);
  const pending = useRef(false);
  const key = useRef('');
  const date = (value: string) => new Date(value).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'});
  const eligible = (row: StockHistory) => row.kind === 'issue' && editUntil(row) > Date.now() && permitted(data.user.role,'handoff')
    && (isManagement(data.user.role) || data.user.role==='Supervisor' || row.actor_id === data.user.id);
  const delta = editing ? Number(quantity) - editing.quantity : 0;
  const raw = editing ? stockAvailable(data.balances,editing.company_id,editing.product_id,'raw',null) : 0;
  const outstanding = editing ? stockAvailable(data.balances,editing.company_id,editing.product_id,'artisan',editing.artisan_id) : 0;
  const valid = Number.isInteger(Number(quantity)) && Number(quantity) >= 1 && Number(quantity) <= maxStockQuantity && delta !== 0 && delta <= raw && -delta <= outstanding;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing || !valid || pending.current || loading) return;
    pending.current = true;
    setSaving(true);
    setError('');
    key.current ||= crypto.randomUUID();
    try {
      await save({kind:'issue_edit',id:editing.id,quantity:Number(quantity),expectedQuantity:editing.quantity},key.current);
      setEditing(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to update the handoff.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  return <>
    <div className="qty-title"><div><h1>{office ? 'Office History' : 'Stock History'}</h1><p>{office ? 'Receipts, sales and returns with the name of the staff member who saved each entry.' : 'Handoff quantities are editable for seven days.'}</p></div>
      <label className="qty-field compact"><span>Company</span><select disabled={loading || saving || !!officeEdit} value={company} onChange={event => {setEditing(null);setCompany(event.target.value);}}>
        <option value="">All companies</option>{data.companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label></div>
    <section className="qty-panel qty-history">
      {!data.history.length && <p className="qty-empty">No movements for this selection.</p>}
      <ul>{data.history.map(row => <li key={row.id}>
        <div className="qty-history-line"><div><strong>{movementLabel(row)}</strong>
          <small>{name(data.companies,row.company_id)} · {name(data.products,row.product_id)}{row.artisan_id ? ' · ' + name(data.artisans,row.artisan_id) : ''}</small>
          <small>{date(row.created_at)} · {row.actor}{row.actor_role ? ' · ' + row.actor_role : ''}{row.preferred_work ? ' · Preferred work: '+row.preferred_work : ''}{row.reference ? ' · Bill ' + row.reference : ''}{row.received_on ? ' · Arrival ' + row.received_on : ''}</small>
          {row.kind !== 'legacy' && row.notes && <small>{row.notes}</small>}</div>
          <div><b>{row.kind === 'issue_edit' ? `${row.previous_quantity} → ${row.new_quantity}` : count(row.quantity)} pcs</b>
            {office && row.kind==='office_vendor_receipt' && permitted(data.user.role,'officeEdit')
              && canEditOfficeEntry(data.user.role,row.created_at) && <button type="button" disabled={loading||!!officeEdit} onClick={()=>setOfficeEdit(row)}>Edit receipt details</button>}
            {eligible(row) && <button type="button" disabled={saving || loading} onClick={() => {setEditing(row);setQuantity(String(row.quantity));setError('');key.current='';}}>Edit quantity</button>}</div></div>
        {officeEdit?.id===row.id && <OfficeReceiptEditor row={officeEdit} save={save} close={()=>setOfficeEdit(null)}/>}
        {editing?.id === row.id && <form className="qty-inline" onSubmit={submit}>
          <label className="qty-field"><span>Correct quantity</span><input autoFocus type="number" inputMode="numeric" step={1} min={1} max={maxStockQuantity} disabled={saving} value={quantity} onChange={event => {setQuantity(event.target.value);key.current='';}}/></label>
          <p>{delta > raw || -delta > outstanding ? 'This change exceeds the available balance.' : `Raw after saving: ${count(raw-delta)} pcs · With artisan: ${count(outstanding+delta)} pcs`}</p>
          <button type="button" disabled={saving} onClick={() => setEditing(null)}>Cancel</button>
          <button className="qty-primary" disabled={!valid || saving || loading}>{saving ? 'Saving…' : 'Save correction'}</button>
          {error && <p className="qty-status bad" role="alert">{error}</p>}
        </form>}
      </li>)}</ul>
      <footer><button type="button" disabled={page === 0 || loading || saving || !!officeEdit} onClick={() => {setEditing(null);setPage(page-1);}}>Previous</button>
        <span>Page {page + 1}</span><button type="button" disabled={!data.more || loading || saving || !!officeEdit} onClick={() => {setEditing(null);setPage(page+1);}}>Next</button></footer>
    </section>
  </>;
}

function OfficeReceiptEditor({row,save,close}: {row:StockHistory;save:Save;close:()=>void}) {
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const key=useRef('');
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);setError('');
    const fields=Object.fromEntries(new FormData(event.currentTarget));
    key.current ||= crypto.randomUUID();
    try {
      await save({kind:'office_entry_edit',id:row.id,...fields,
        expected:{received_on:row.received_on,reference:row.reference,notes:row.notes}},key.current);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the receipt.');
    } finally {
      setBusy(false);
    }
  }
  return <form className="qty-inline" onSubmit={submit} onChange={()=>{key.current='';}}>
    <label className="qty-field"><span>Arrival date</span><input name="receivedOn" type="date" required disabled={busy} defaultValue={row.received_on||''}/></label>
    <label className="qty-field"><span>Bill / challan</span><input name="reference" disabled={busy} maxLength={200} defaultValue={row.reference}/></label>
    <label className="qty-field"><span>Notes</span><input name="notes" disabled={busy} maxLength={1000} defaultValue={row.notes}/></label>
    <label className="qty-field"><span>Correction reason</span><input name="reason" required minLength={3} maxLength={1000} disabled={busy}/></label>
    <button type="button" onClick={close} disabled={busy}>Cancel</button><button type="submit" className="qty-primary" disabled={busy}>{busy?'Saving…':'Save details'}</button>
    {error && <p className="qty-status bad" role="alert">{error}</p>}
  </form>;
}
