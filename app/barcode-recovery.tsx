'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Search, Printer, ShieldCheck, AlertCircle, ArrowLeft, RotateCcw, Barcode } from 'lucide-react';
import ScannerInput from './scanner-input';
import './barcode-recovery.css';

type Props = { d: any; action: any; busy: boolean; initialCode?: string; onPrint: (codes: string[]) => void };
const readable = (value: string) => (value || '').replaceAll('_', ' ').toLowerCase().replace(/^./, s => s.toUpperCase());
const compact = (value: string) => (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const matchType = (code: string, query: string) => {
  const candidate = compact(code), fragment = compact(query);
  if (!fragment) return 'Record details match';
  if (candidate === fragment) return 'Exact barcode match';
  if (candidate.includes(fragment)) return 'Partial barcode match';
  return 'Record details match';
};

export default function BarcodeRecovery({ d, action, busy: externalBusy, initialCode = '', onPrint }: Props) {
  const [query, setQuery] = useState(initialCode), [company, setCompany] = useState(''), [product, setProduct] = useState('');
  const [candidates, setCandidates] = useState<any[]>([]), [searched, setSearched] = useState(false), [more, setMore] = useState(false);
  const [selected, setSelected] = useState<any>(null), [active, setActive] = useState<any>(null), [records, setRecords] = useState<any[]>([]);
  const [status, setStatus] = useState('OPEN'), [page, setPage] = useState(0), [moreRecords, setMoreRecords] = useState(false);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [reporting, setReporting] = useState(false), [creatingIdentity, setCreatingIdentity] = useState(false), [saving, setSaving] = useState(false);
  const [newCompany, setNewCompany] = useState(''), [newProduct, setNewProduct] = useState('');
  const [scanAttempt, setScanAttempt] = useState<{ code: string; source: string; count: number } | null>(null);
  const [attached, setAttached] = useState(false), [scan, setScan] = useState<{ code: string; source: string } | null>(null);
  const searchVersion = useRef(0), recordVersion = useRef(0), savingRef = useRef(false), operationKey = useRef({ payload: '', key: '' });
  const busy = externalBusy || saving;
  const date = (value: string) => value ? new Date(value).toLocaleString('en-IN', { timeZone: d.settings.timezone || 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '—';
  async function read(params: Record<string, string>, signal?: AbortSignal) {
    const response = await fetch('/api/ledger?' + new URLSearchParams(params), { cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Recovery could not be loaded. Please try again.');
    return result;
  }
  async function loadRecords(signal?: AbortSignal) {
    const version = ++recordVersion.current;
    const result = await read({ recovery: 'records', status, offset: String(page * 20) }, signal);
    if (version !== recordVersion.current) return;
    setRecords(result.recoveries); setMoreRecords(result.hasMore);
  }
  useEffect(() => {
    const controller = new AbortController();
    loadRecords(controller.signal).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [status, page]);
  async function search(code = query, source = '') {
    const version = ++searchVersion.current;
    setLoading(true); setError(''); setSelected(null);
    try {
      const result = await read({ recovery: 'search', q: code, company, product });
      if (version !== searchVersion.current) return;
      setCandidates(result.candidates); setMore(result.hasMore); setSearched(true);
      setScanAttempt(source ? { code, source, count: result.candidates.length } : null);
    } catch (e: any) { if (version === searchVersion.current) setError(e.message); }
    finally { if (version === searchVersion.current) setLoading(false); }
  }
  useEffect(() => { if (initialCode) void search(initialCode); }, [initialCode]);
  async function save(op: string, data: any, print = false) {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    setError('');
    try {
    // A network retry reuses its key; changing the operation or data creates a new one.
    const payload = JSON.stringify({ op, data });
    if (operationKey.current.payload !== payload) operationKey.current = { payload, key: crypto.randomUUID() };
    const result = await action(op, data, undefined, operationKey.current.key);
    if (!result) return;
    operationKey.current = { payload: '', key: '' };
    setSelected(null); setReporting(false); setCreatingIdentity(false); setAttached(false); setScan(null);
    if (op === 'recoveryCreate') { setNewCompany(''); setNewProduct(''); }
    try {
      const detail = await read({ recovery: 'records', id: result.recoveryId });
      setActive(detail.recoveries[0] || null);
      await loadRecords();
    } catch (e: any) { setError('Saved, but the recovery list could not refresh. Reopen Barcode Recovery to resume. ' + e.message); }
    if (print && result.codes) onPrint(result.codes);
    } finally { savingRef.current = false; setSaving(false); }
  }
  function reset() { setActive(null); setSelected(null); setReporting(false); setCreatingIdentity(false); setAttached(false); setScan(null); setError(''); }
  const awaiting = active?.status === 'AWAITING_SCAN';
  const closed = active && ['CONFIRMED', 'CANCELLED'].includes(active.status);
  const officeRole = ['Office Staff', 'Assistant Manager', 'Office Manager'].includes(d.user?.role);
  const canCreateNoBarcode = !officeRole || ['Assistant Manager', 'Office Manager'].includes(d.user?.role);
  const recoveryCompanies = d.companies.filter((item: any) => item.active !== 0 && (officeRole ? item.office_only === 1 : item.office_only !== 1));
  const recoveryProducts = d.products.filter((item: any) => item.active !== 0 && (officeRole ? item.office_only === 1 : item.office_only !== 1));
  const selectedNewCompany = recoveryCompanies.find((item: any) => item.id === newCompany);
  let activeSnapshot: any = {};
  try { activeSnapshot = JSON.parse(active?.snapshot || '{}'); } catch {}
  const createdNewIdentity = activeSnapshot.recovery_new_identity === true;
  return <div className="barcode-recovery">
    <div className="recovery-intro"><ShieldCheck size={24}/><div><b>Recover the label without losing stock control.</b><p>{canCreateNoBarcode ? 'If the saree can be identified, print its original code. Only when no barcode or exact saved identity can be recovered, use the separate controlled new-code option below.' : 'Find the exact saree and reprint its original code. A new outside-vendor identity must be created by an Assistant Manager or Office Manager.'}</p></div></div>
    {error && <div role="alert" className="form-error"><AlertCircle size={16}/>{error}</div>}
    {!active && canCreateNoBarcode && <section className={'recovery-no-code ' + (creatingIdentity ? 'open' : '')}>
      <div className="recovery-no-code-heading"><div className="recovery-no-code-icon"><Barcode size={22}/></div><div><span className="eyebrow">NO BARCODE AVAILABLE</span><h3>Barcode absent recovery</h3><p>The old barcode cannot be read, scanned or matched at all? Create one controlled permanent identity from company and product—without scanning first.</p></div><button type="button" className="btn" disabled={busy} aria-expanded={creatingIdentity} onClick={() => { setCreatingIdentity(!creatingIdentity); setReporting(false); }}>{creatingIdentity ? 'Close' : 'Create recovery barcode'}</button></div>
      {creatingIdentity && <form className="recovery-new-identity-form" onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void save('recoveryCreate', { company_id: data.get('company_id'), product_id: data.get('product_id'), thanwala_id: data.get('thanwala_id'), received_at: data.get('received_at'), reference: data.get('reference'), confirmed: data.get('confirmed') === 'on' }, true); }}>
        <div className="recovery-new-identity-warning"><AlertCircle size={17}/><span>Use this only after the damaged-label search cannot identify the saree. It creates a <b>new permanent Piece Code</b>; it does not guess or overwrite an old code.</span></div>
        <div className="form-grid"><label className="field"><span>{officeRole ? 'Outside vendor' : 'Company / Own brand'} *</span><select name="company_id" required value={newCompany} onChange={e => setNewCompany(e.target.value)}><option value="" disabled>Choose {officeRole ? 'vendor' : 'company'}</option>{recoveryCompanies.map((item: any) => <option key={item.id} value={item.id}>{item.name}{!officeRole && item.ownership === 'OWN' ? ' · Own Product' : ''}</option>)}</select></label><label className="field"><span>Product *</span><select name="product_id" required value={newProduct} onChange={e => setNewProduct(e.target.value)}><option value="" disabled>Choose product</option>{recoveryProducts.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
        {selectedNewCompany?.ownership === 'OWN' && <label className="field"><span>Thanwala / purchase source *</span><select name="thanwala_id" required defaultValue=""><option value="" disabled>Choose Thanwala</option>{d.thanwalas.filter((item: any) => item.active !== 0).map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>Required for TaraFabbs Own Product so the original purchase source stays traceable.</small></label>}
        <div className="form-grid"><label className="field"><span>Received date <small>(optional)</small></span><input type="date" name="received_at"/></label><label className="field"><span>Bill / challan number <small>(optional)</small></span><input name="reference" maxLength={200} placeholder="Leave blank if unavailable"/></label></div>
        <div className="recovery-new-identity-summary"><b>What happens next</b><span>1. New code is reserved and label preview opens</span><span>2. Print and attach it to this saree</span><span>3. Scan the attached label to confirm</span><span>4. Use the normal Scan In / Office scan to complete inventory entry</span></div>
        <label className="checkbox"><input name="confirmed" type="checkbox" required/>I checked the physical saree and available records. No original barcode or exact existing Piece Code can be recovered, so a new permanent identity is required.</label>
        <button className="btn primary" disabled={busy || !newCompany || !newProduct}><Printer size={16}/>{busy ? 'Creating…' : 'Create, preview & print barcode'}</button>
      </form>}
    </section>}
    {active && <section className="recovery-card">
      <div className="recovery-card-heading"><div><small>RECOVERY {active.id.slice(0, 8).toUpperCase()}</small><h3>{active.code || 'Unidentified physical item'}</h3><span className={'badge ' + (closed ? 'green' : 'amber')}>{readable(active.status)}</span></div><button className="btn" disabled={busy} onClick={reset}><ArrowLeft size={15}/>Back to search</button></div>
      <dl className="recovery-details"><div><dt>Reported by / on</dt><dd>{active.actor} · {date(active.created_at)}</dd></div><div><dt>Problem / location</dt><dd>{active.reason}</dd></div>{active.evidence && <div><dt>Identification evidence</dt><dd>{active.evidence}<small>{active.identified_by} · {date(active.identified_at)}</small></dd></div>}{active.confirmed_at && <div><dt>Replacement confirmed</dt><dd>{active.confirmed_by} · {date(active.confirmed_at)}</dd></div>}{active.closed_reason && <div><dt>Cancellation reason</dt><dd>{active.closed_reason} · {date(active.closed_at)}</dd></div>}</dl>
      {active.status === 'UNIDENTIFIED' && <p className="inline-warning">Keep this physical piece separate and mark it with recovery reference {active.id.slice(0, 8).toUpperCase()}. Search below when its exact identity can be established. This report does not create stock or a barcode.</p>}
      {awaiting && <>{createdNewIdentity && <div className="recovery-created-identity"><Barcode size={18}/><span><b>New permanent identity created from {activeSnapshot.company_name} · {activeSnapshot.product_name}.</b> It remains pending until this label is attached and scanned, then the normal inventory scan is completed.</span></div>}<div className="recovery-steps"><b>1. Print</b><span>2. Attach to the verified saree</span><span>3. Check the replacement</span></div><button className="btn" disabled={busy} onClick={() => save('recoveryPrint', { id: active.id }, true)}><Printer size={16}/>Print / retry same label</button><p className="muted">Closing the print dialog does not complete this recovery. If the printer failed, retry here. Discard all spare copies and the old label.</p><label className="checkbox"><input type="checkbox" checked={attached} onChange={e => { setAttached(e.target.checked); setScan(null); }}/>I attached the replacement to this exact saree and removed old / spare labels.</label><ScannerInput disabled={busy || !attached} onScan={(code, source) => { if (code !== active.code) { setScan(null); setError('Wrong barcode. Scan the replacement for ' + active.code + '. Nothing has changed.'); } else { setScan({ code, source }); setError(''); } }}/>{scan && <div className="info-strip">Matched {scan.code}. This confirms only the label; continue the normal scan workflow for any stock movement.</div>}<button className="btn primary" disabled={busy || !attached || !scan} onClick={() => save('recoveryConfirm', { id: active.id, code: scan!.code, source: scan!.source, attached })}><ShieldCheck size={16}/>Confirm attached replacement</button></>}
      {!closed && !createdNewIdentity && <details className="recovery-cancel"><summary>Cancel this recovery</summary><form onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void save('recoveryCancel', { id: active.id, reason: data.get('reason') }); }}><label className="field"><span>Reason for cancellation</span><input name="reason" required minLength={3} maxLength={2000} placeholder="Duplicate report, voided label, or no replacement needed"/></label><p className="muted">Destroy any replacement copies already printed for a cancelled request.</p><button className="btn" disabled={busy}>Record cancellation</button></form></details>}
    </section>}
    {!awaiting && !closed && <><section className="recovery-search"><div className="recovery-search-grid"><form className="recovery-search-form" onSubmit={e => { e.preventDefault(); void search(); }}><h3>{active ? 'Identify this reported item' : 'Find a damaged or missing barcode'}</h3><label className="field"><span>Piece code, bill number, lot, company, product or artist</span><input value={query} onChange={e => { setQuery(e.target.value); setScanAttempt(null); }} placeholder="Even part of the printed code can help" maxLength={150}/></label><div className="form-grid"><label className="field"><span>Company</span><select value={company} onChange={e => setCompany(e.target.value)}><option value="">All companies</option>{d.companies.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="field"><span>Product</span><select value={product} onChange={e => setProduct(e.target.value)}><option value="">All products</option>{d.products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div><button className="btn primary" disabled={busy || loading || (query.trim().length < 2 && !company && !product)}><Search size={16}/>{loading ? 'Searching…' : 'Find matching records'}</button></form><aside className="recovery-damaged-reader"><div><span className="eyebrow">DAMAGED BARCODE SCANNER</span><h3>Scan the broken label</h3><p>Camera and USB scanner will try to decode the remaining bars. You can also enter any readable letters or digits.</p></div><ScannerInput damagedMode disabled={busy || loading} onScan={(code, source) => { setQuery(code); void search(code, source); }}/>{scanAttempt && <div className={scanAttempt.count ? 'scanner-match-note success' : 'scanner-match-note'}><b>{scanAttempt.count ? `${scanAttempt.count} possible match${scanAttempt.count === 1 ? '' : 'es'} found` : 'No match from this scan'}</b><small>{scanAttempt.code} · {scanAttempt.source === 'camera' ? 'camera' : 'scanner / visible part'}</small></div>}<small className="muted">A badly torn Code 128 may not decode. Enter the visible code fragment above and the system will still search without hyphens or spaces.</small></aside></div></section>
    {searched && <div className="recovery-matches"><p className="muted">{candidates.length} matching records{more ? ' shown — narrow your search to find more' : ''}. A matching product alone does not prove a piece’s identity.</p>{!candidates.length && <div className="info-strip">No valid labels found. Try the readable part again, then use the original bill, lot or company; voided labels cannot be recovered.</div>}{candidates.map(item => <button type="button" className={'recovery-match ' + (selected?.id === item.id ? 'selected' : '')} key={item.code} disabled={busy} onClick={() => setSelected(item)}><span><b className="mono">{item.code}</b><small className={'recovery-match-type '+(matchType(item.code,query).startsWith('Exact')?'exact':matchType(item.code,query).startsWith('Partial')?'partial':'')}>{matchType(item.code,query)}</small><small>{item.company_name} · {item.product_name}</small><small>Bill: {item.bill_number || 'Not recorded'} · {item.lot_number}</small><small>Received: {item.received_at?.slice(0, 10)} · {[item.color, item.design, item.material].filter(Boolean).join(' · ')}</small></span><span><b>{item.artisan_name || readable(item.holder)}</b><small>{readable(item.condition)}</small><small>{selected?.id === item.id ? 'Selected for verification' : 'Review this piece →'}</small></span></button>)}</div>}
    {selected && <form key={selected.code} className="recovery-card" onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void save('recoveryStart', { id: active?.id, code: selected.code, reason: data.get('reason'), evidence: data.get('evidence'), verified: data.get('verified') === 'on' }, true); }}><h3>Verify physical piece · {selected.code}</h3><p>{selected.company_name} · {selected.product_name} · Bill {selected.bill_number || 'not recorded'} · {selected.lot_number}</p><label className="field"><span>Why does the label need replacement?</span><select name="reason" required defaultValue=""><option value="" disabled>Choose a reason</option><option>Barcode torn / damaged</option><option>Print faded / unreadable</option><option>Label lost / detached</option><option>Printer failure / accidental damage</option><option>Other label problem</option></select></label><label className="field"><span>How did you identify this exact saree?</span><textarea name="evidence" required minLength={10} maxLength={2000} rows={3} placeholder="Readable code digits, separate piece tag, recorded design / distinguishing mark, or verified artist handover record…"/></label><p className="inline-warning">If multiple sarees are indistinguishable, do not guess a code. Keep the item separate and record it as unidentified until its identity is confirmed.</p><label className="checkbox"><input type="checkbox" name="verified" required/>I have physically matched this saree uniquely to {selected.code}; it is not another piece from the same lot.</label><button className="btn primary" disabled={busy}><Printer size={16}/>Record recovery & print original barcode</button></form>}
    {!active && <div className="recovery-unidentified"><button className="text-btn" disabled={busy} onClick={() => setReporting(!reporting)}><AlertCircle size={16}/>Cannot identify the exact saree?</button>{reporting && <form onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void save('recoveryReport', { reason: data.get('reason') }); }}><label className="field"><span>Physical description, problem and where the item is kept</span><textarea name="reason" required minLength={10} maxLength={2000} rows={3} placeholder="Describe colour / design, suspected bill, artist, and the shelf / person holding this saree."/></label><button className="btn" disabled={busy}>Save unidentified item report</button></form>}</div>}</>}
    <section className="recovery-records"><div className="recovery-card-heading"><div><h3>Recovery register</h3><p className="muted">Resume interrupted replacements or review completed records.</p></div><button className="btn" disabled={busy} onClick={() => loadRecords().catch(e => setError(e.message))}><RotateCcw size={15}/>Refresh</button></div><label className="field"><span>Show records</span><select value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}><option value="OPEN">Pending / unidentified</option><option value="CLOSED">Completed / cancelled</option><option value="ALL">All recovery history</option></select></label><div className="recovery-log">{records.map(record => <button className="recovery-match" disabled={busy} key={record.id} onClick={() => { reset(); setActive(record); }}><span><b>{record.code || 'Unidentified item'} <small>· {record.id.slice(0, 8).toUpperCase()}</small></b><small>{record.reason}</small><small>{record.actor} · {date(record.created_at)}</small></span><span>{readable(record.status)} →</span></button>)}{!records.length && <p className="muted">No recovery records in this category.</p>}</div><div className="recovery-pagination"><button className="btn" disabled={!page} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page + 1}</span><button className="btn" disabled={!moreRecords} onClick={() => setPage(page + 1)}>Next</button></div></section>
  </div>;
}
