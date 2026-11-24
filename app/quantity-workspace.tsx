'use client';

import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {ArrowDownLeft, ArrowUpRight, ClipboardList, LayoutDashboard, Package, Plus, Wrench} from 'lucide-react';
import {artisanWorkTypes, permitted} from '@/lib/rules';
import {
  issueEditWindow, maxStockQuantity, stageLabels, stockAvailable, stockOperations, trackedArtisan,
  type StockHistory, type StockMaster, type StockOperation, type StockSnapshot, type StockStage,
} from '@/lib/quantity-stock';
import SignOutButton from './sign-out-button';
import './quantity-workspace.css';

const navigation = [
  ['dashboard', 'Company Dashboard', LayoutDashboard],
  ['receipt', 'New Entry', Plus],
  ['issue', 'Send to Artisan', ArrowUpRight],
  ['receive', 'Receive from Artisan', ArrowDownLeft],
  ['manage', 'Repair & Delivery', Wrench],
  ['history', 'History', ClipboardList],
] as const;
type Screen = typeof navigation[number][0];
type Save = (body: Record<string, unknown>, key: string) => Promise<void>;
type Masters = 'companies' | 'products' | 'thanwalas' | 'artisans';
const masterLabels = {companies: 'Company', products: 'Category', thanwalas: 'Thanwala', artisans: 'Artisan'};
const count = (value: number) => value.toLocaleString('en-IN');
const today = () => new Date().toLocaleDateString('en-CA', {timeZone: 'Asia/Kolkata'});
const editUntil = (row: StockHistory) => Date.parse(row.created_at) + issueEditWindow;
const name = (items: StockMaster[], id: string | null) => items.find(item => item.id === id)?.name || '—';
const movementLabel = (row: StockHistory) => row.kind === 'legacy' ? row.notes
  : row.kind === 'issue_edit' ? 'Handoff quantity edited' : stockOperations[row.kind].label;

const extraOperations: StockOperation[] = [
  'dispatch', 'mark_repair', 'send_repair', 'receive_repaired', 'mark_dispute',
  'raw_dispute', 'repair_dispute', 'resolve_dispute', 'dispute_return', 'accept_pending',
];

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {...init, cache: 'no-store'});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The inventory request failed. Please try again.');
  return data;
}

export default function QuantityWorkspace() {
  const [data, setData] = useState<StockSnapshot | null>(null);
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [company, setCompany] = useState('');
  const [page, setPage] = useState(0);
  const [historyCompany, setHistoryCompany] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const latestRead = useRef(0);

  const refresh = useCallback(async (offset: number, filter: string) => {
    const request = ++latestRead.current;
    setLoading(true);
    setError('');
    try {
      const result = await requestJson('/api/quantity-stock?' + new URLSearchParams({page: String(offset), company: filter}));
      if (request === latestRead.current) setData(result);
    } catch (error) {
      if (request === latestRead.current) setError(error instanceof Error ? error.message : 'Could not load stock.');
    } finally {
      if (request === latestRead.current) setLoading(false);
    }
  }, []);

  useEffect(() => {void refresh(page, historyCompany);}, [page, historyCompany, refresh]);

  const go = (next: Screen) => {
    setNotice('');
    setScreen(next);
  };

  const save: Save = async (body, key) => {
    await requestJson('/api/quantity-stock', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...body, key}),
    });
    setNotice('Saved. Company and artisan balances have been updated.');
    await refresh(page, historyCompany);
  };

  async function addMaster(kind: Masters, entryName: string, workType: string, description: string) {
    const result = await requestJson('/api/ledger', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({op: 'master', key: crypto.randomUUID(), data: {
        kind, name: entryName, ...(kind === 'companies' ? {ownership: 'EXTERNAL'} : {}),
        ...(kind === 'artisans' ? {work_type: workType, work_description: description} : {}),
      }}),
    });
    await refresh(page, historyCompany);
    return result.id as string;
  }

  const role = data?.user.role || '';
  const shownTabs = navigation.filter(([key]) => (
    key === 'receipt' ? permitted(role,'receipt') :
    key === 'issue' ? permitted(role,'handoff') :
    key === 'receive' ? permitted(role,'return') :
    key === 'manage' ? extraOperations.some(operation => permitted(role, stockOperations[operation].permission)) : true
  ));

  return <div className="qty-app">
    <header className="qty-header">
      <div className="qty-brand"><span><Package size={22}/></span><div><strong>IMS TARA MAA</strong><small>Stock management</small></div></div>
      <div className="qty-account">{data && <><span>{data.user.name}</span>{role === 'Admin' && <a href="/?view=Office">Office</a>}</>}<SignOutButton/></div>
    </header>
    <nav className="qty-nav" aria-label="Inventory navigation">
      {shownTabs.map(([key,label,Icon]) => <button type="button" key={key} aria-current={screen === key ? 'page' : undefined} onClick={() => go(key)}><Icon size={18}/>{label}</button>)}
    </nav>
    <main className="qty-main" aria-busy={loading}>
      {error && <p className="qty-status bad" role="alert">{error} <button type="button" onClick={() => void refresh(page, historyCompany)}>Reload stock</button></p>}
      {notice && <p className="qty-status" role="status">{notice}</p>}
      {!data && !error && <p role="status">Loading stock…</p>}
      {data && screen === 'dashboard' && <Dashboard data={data} company={company} setCompany={setCompany} onAction={go}/>}
      {data && ['receipt','issue','receive','manage'].includes(screen) && <MovementForm key={screen} screen={screen as Exclude<Screen,'dashboard'|'history'>}
        data={data} initialCompany={company} save={save} addMaster={addMaster} loading={loading}/>}
      {data && screen === 'history' && <History data={data} page={page} setPage={setPage} company={historyCompany} setCompany={id => {setPage(0);setHistoryCompany(id);}}
        loading={loading} save={save}/>}
    </main>
  </div>;
}

function Dashboard({data, company, setCompany, onAction}: {
  data: StockSnapshot; company: string; setCompany: (id: string) => void; onAction: (screen: Screen) => void;
}) {
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
  const due = (row: typeof rows[number]) => Math.max(0, row.received - (row.stages.delivered || 0) - (row.stages.dispute_returned || 0) - (row.stages.office || 0));
  const sumStage = (stage: StockStage) => rows.reduce((total,row) => total + (row.stages[stage] || 0),0);
  const cards = [
    ['Raw stock', sumStage('raw')],
    ['With artisans', sumStage('artisan')],
    ['Ready for company', sumStage('ready')],
    ['Still due to companies', rows.filter(row => data.companies.find(c => c.id === row.company)?.ownership === 'EXTERNAL').reduce((sum,row) => sum + due(row),0)],
  ] as const;
  return <>
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
          ...(stage.office ? [['Transferred to office',stage.office]] : []),
        ].map(([label,quantity]) => <div key={label}><dt>{label}</dt><dd>{count(Number(quantity || 0))}</dd></div>)}</dl>
      </section>;
    })}</div>
    {data.balances.some(row => (!company || row.company_id === company) && row.quantity > 0 && row.artisan_id) &&
      <section className="qty-panel qty-outstanding"><h2>Stock with artisans</h2><ul>{data.balances
        .filter(row => (!company || row.company_id === company) && row.quantity > 0 && row.artisan_id)
        .map(row => <li key={JSON.stringify([row.company_id,row.product_id,row.artisan_id,row.stage])}>
          <span><strong>{name(data.artisans,row.artisan_id)}</strong><small>{name(data.companies,row.company_id)} · {name(data.products,row.product_id)}{row.stage === 'repair_artisan' ? ' · Repair' : ''}</small></span>
          <b>{count(row.quantity)} pcs</b></li>)}</ul></section>}
  </>;
}

function MovementForm({screen,data,initialCompany,save,addMaster,loading}: {
  screen: 'receipt' | 'issue' | 'receive' | 'manage'; data: StockSnapshot; initialCompany: string;
  save: Save; addMaster: (kind: Masters, name: string, workType: string, description: string) => Promise<string>; loading: boolean;
}) {
  const manageChoices = extraOperations.filter(key => permitted(data.user.role,stockOperations[key].permission));
  const [kind,setKind] = useState<StockOperation>(screen === 'manage' ? manageChoices[0] || 'dispatch' : screen);
  const [company,setCompany] = useState(initialCompany);
  const [product,setProduct] = useState('');
  const [artisan,setArtisan] = useState('');
  const [thanwala,setThanwala] = useState('');
  const [quantity,setQuantity] = useState('');
  const [date,setDate] = useState(today);
  const [reference,setReference] = useState('');
  const [notes,setNotes] = useState('');
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState('');
  const [newMaster,setNewMaster] = useState<Masters | null>(null);
  const [masterName,setMasterName] = useState('');
  const [workType,setWorkType] = useState('');
  const [workDescription,setWorkDescription] = useState('');
  const key = useRef('');
  const savingRef = useRef(false);
  const operation = stockOperations[kind];
  const needsArtisan = Boolean(trackedArtisan(operation.from,'yes') || trackedArtisan(operation.to,'yes'));
  const countInStock = stockAvailable(data.balances,company,product,operation.from,artisan || null);
  const number = Number(quantity);
  const hasQuantity = Number.isInteger(number) && number > 0 && number <= maxStockQuantity;
  const exceed = operation.from !== null && number > countInStock;
  const own = data.companies.find(item => item.id === company)?.ownership === 'OWN';
  const reasonRequired = operation.to === 'disputed' || kind === 'dispute_return';
  const canCreate = kind === 'receipt' && permitted(data.user.role,'masterCreate');
  const canCreateArtisan = ['issue','send_repair'].includes(kind) && permitted(data.user.role,'masterCreate');
  const validMaster = masterName.trim() && (newMaster !== 'artisans'
    || (workType && (workType !== 'Others' || workDescription.trim())));
  const inStock = (companyId: string, productId?: string) => data.balances.some(row => row.company_id === companyId
    && (!productId || row.product_id === productId) && row.stage === operation.from && row.quantity > 0);
  const companies = data.companies.filter(item => (kind !== 'dispatch' || item.ownership === 'EXTERNAL')
    && (kind === 'receipt' ? item.active : inStock(item.id)));
  const products = data.products.filter(item => kind === 'receipt' ? item.active : inStock(company,item.id));
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
        quantity:number,receivedOn:date,reference,notes}, key.current);
      setQuantity('');setReference('');setNotes('');key.current = '';
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
      const id = await addMaster(newMaster,masterName.trim(),workType,workDescription.trim());
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
    && <button type="button" className="qty-small" onClick={() => {setNewMaster(kind);setMasterName('');setWorkType('');setWorkDescription('');setError('');}}><Plus size={15}/>Add {masterLabels[kind].toLowerCase()}</button>;
  return <div className="qty-work">
    <div className="qty-title"><div><h1>{screen === 'manage' ? 'Repair & Delivery' : stockOperations[screen].label}</h1>
      <p>{screen === 'receipt' ? 'Add received pieces to raw stock.' : screen === 'issue' ? 'Choose a company, category and artisan to issue raw stock.'
        : screen === 'receive' ? 'Record returned work in its own stock balance.' : 'Record repair, disputes and delivery against the company’s balance.'}</p></div></div>
    <form className="qty-panel qty-form" onSubmit={submit}>
      <fieldset disabled={saving || loading}>
        {(screen === 'manage' || screen === 'receive') && <label className="qty-field"><span>{screen === 'receive' ? 'Return status' : 'Action'}</span><select value={kind} onChange={event => {setKind(event.target.value as StockOperation);setArtisan('');changed();}}>
          {(screen === 'receive' ? ['receive','receive_repair','receive_dispute'] as const : manageChoices).map(key =>
            <option key={key} value={key}>{screen === 'receive' ? ({receive:'Ready for company',receive_repair:'Needs repair',receive_dispute:'Disputed'} as Record<string,string>)[key] : stockOperations[key].label}</option>)}
        </select></label>}
        <div className="qty-fields">
          <div><label className="qty-field"><span>Company / party</span><select value={company} required onChange={event => {setCompany(event.target.value);setProduct('');setArtisan('');setThanwala('');changed();}}>
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
          {newMaster === 'artisans' && <label className="qty-field"><span>Work type</span><select value={workType} onChange={event => setWorkType(event.target.value)}>
            <option value="">Select work type</option>{artisanWorkTypes.map(type => <option key={type}>{type}</option>)}
          </select></label>}
          {newMaster === 'artisans' && workType === 'Others' && <label className="qty-field"><span>Work description</span><input value={workDescription} maxLength={300} onChange={event => setWorkDescription(event.target.value)}/></label>}
          <button type="button" onClick={() => setNewMaster(null)}>Cancel</button>
          <button type="button" className="qty-primary" disabled={!validMaster} onClick={() => void create()}>Add & select</button>
        </div>}
        {!companies.length && kind !== 'receipt' && <p className="qty-empty">No company has stock available for this action.</p>}
        <div className="qty-fields">
          {operation.from && <div className="qty-figure"><span>{stageLabels[operation.from]} available</span><strong>{count(countInStock)} pcs</strong></div>}
          <label className="qty-field"><span>Quantity (pcs)</span><input required inputMode="numeric" type="number" min={1} max={maxStockQuantity} step={1} value={quantity} placeholder="0" onChange={event => {setQuantity(event.target.value);changed();}}/></label>
          {operation.from && <div className={'qty-figure ' + (exceed ? 'bad' : '')} aria-live="polite"><span>Balance after saving</span><strong>{exceed ? 'Insufficient stock' : `${count(countInStock - (hasQuantity ? number : 0))} pcs`}</strong></div>}
        </div>
        {kind === 'receipt' && <div className="qty-fields">
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

function History({data,page,setPage,company,setCompany,loading,save}: {
  data: StockSnapshot; page: number; setPage: (page: number) => void; company: string; setCompany: (id: string) => void;
  loading: boolean; save: Save;
}) {
  const [editing,setEditing] = useState<StockHistory | null>(null);
  const [quantity,setQuantity] = useState('');
  const [error,setError] = useState('');
  const [saving,setSaving] = useState(false);
  const pending = useRef(false);
  const key = useRef('');
  const date = (value: string) => new Date(value).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'});
  const eligible = (row: StockHistory) => row.kind === 'issue' && editUntil(row) > Date.now() && permitted(data.user.role,'handoff')
    && (['Admin','Supervisor'].includes(data.user.role) || row.actor_id === data.user.id);
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
    <div className="qty-title"><div><h1>Stock History</h1><p>Handoff quantities are editable for seven days.</p></div>
      <label className="qty-field compact"><span>Company</span><select disabled={loading || saving} value={company} onChange={event => {setEditing(null);setCompany(event.target.value);}}>
        <option value="">All companies</option>{data.companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label></div>
    <section className="qty-panel qty-history">
      {!data.history.length && <p className="qty-empty">No movements for this selection.</p>}
      <ul>{data.history.map(row => <li key={row.id}>
        <div className="qty-history-line"><div><strong>{movementLabel(row)}</strong>
          <small>{name(data.companies,row.company_id)} · {name(data.products,row.product_id)}{row.artisan_id ? ' · ' + name(data.artisans,row.artisan_id) : ''}</small>
          <small>{date(row.created_at)} · {row.actor}{row.reference ? ' · Bill ' + row.reference : ''}{row.received_on ? ' · Arrival ' + row.received_on : ''}</small>
          {row.kind !== 'legacy' && row.notes && <small>{row.notes}</small>}</div>
          <div><b>{row.kind === 'issue_edit' ? `${row.previous_quantity} → ${row.new_quantity}` : count(row.quantity)} pcs</b>
            {eligible(row) && <button type="button" disabled={saving || loading} onClick={() => {setEditing(row);setQuantity(String(row.quantity));setError('');key.current='';}}>Edit quantity</button>}</div></div>
        {editing?.id === row.id && <form className="qty-inline" onSubmit={submit}>
          <label className="qty-field"><span>Correct quantity</span><input autoFocus type="number" inputMode="numeric" step={1} min={1} max={maxStockQuantity} disabled={saving} value={quantity} onChange={event => {setQuantity(event.target.value);key.current='';}}/></label>
          <p>{delta > raw || -delta > outstanding ? 'This change exceeds the available balance.' : `Raw after saving: ${count(raw-delta)} pcs · With artisan: ${count(outstanding+delta)} pcs`}</p>
          <button type="button" disabled={saving} onClick={() => setEditing(null)}>Cancel</button>
          <button className="qty-primary" disabled={!valid || saving || loading}>{saving ? 'Saving…' : 'Save correction'}</button>
          {error && <p className="qty-status bad" role="alert">{error}</p>}
        </form>}
      </li>)}</ul>
      <footer><button type="button" disabled={page === 0 || loading || saving} onClick={() => {setEditing(null);setPage(page-1);}}>Previous</button>
        <span>Page {page + 1}</span><button type="button" disabled={!data.more || loading || saving} onClick={() => {setEditing(null);setPage(page+1);}}>Next</button></footer>
    </section>
  </>;
}
