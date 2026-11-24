'use client';

import {useEffect,useState,type FormEvent} from 'react';

const fields = {vendors:['name','contact'],products:['name','material','weave','color','design']} as const;
type Kind = keyof typeof fields;
type RecordRow = {id:string;name:string;[key:string]:string};
type Catalog = {vendors:RecordRow[];products:RecordRow[];audit:{id:string;actor:string;actor_role:string;target_label:string;created_at:string}[]};

export default function OfficeCatalog({request,save}: {
  request:(url:string,init?:RequestInit)=>Promise<Catalog>;
  save:(values:Record<string,unknown>)=>Promise<unknown>;
}) {
  const [data,setData]=useState<Catalog|null>(null);
  const [kind,setKind]=useState<Kind>('vendors');
  const [editing,setEditing]=useState<RecordRow|null>(null);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);

  async function load(signal?:AbortSignal) {
    try {
      const next=await request('/api/ledger?officeCatalog=1',{signal});
      if (!signal?.aborted) setData(next);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Could not load Office records.');
    }
  }
  useEffect(()=>{
    const controller=new AbortController();
    void load(controller.signal);
    return ()=>controller.abort();
  },[]);

  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    const values=Object.fromEntries(new FormData(event.currentTarget));
    const expected=Object.fromEntries(fields[kind].map(field=>[field,editing[field]||'']));
    setBusy(true);setError('');setNotice('');
    try {
      await save({...values,id:editing.id,kind,expected});
      setEditing(null);setNotice('Office record updated.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not edit the Office record.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="qty-title"><div><h1>Office Records</h1><p>Manage outside vendors and Office product categories.</p></div></div>
    {error && <p className="qty-status bad" role="alert">{error}</p>}
    {notice && <p className="qty-status" role="status">{notice}</p>}
    {editing && <form className="qty-panel qty-form qty-staff-form" onSubmit={submit} key={editing.id}>
      <fieldset disabled={busy}><h2>{editing.name}</h2><div className="qty-fields">{fields[kind].map(field=><label className="qty-field" key={field}>
        <span>{field[0].toUpperCase()+field.slice(1)}</span>
        <input name={field} defaultValue={editing[field]||''} required={field==='name'} maxLength={field==='name'?200:2000}/>
      </label>)}</div>
      <label className="qty-field"><span>Correction reason</span><input name="reason" required minLength={3} maxLength={2000}/></label>
      <div className="qty-quick"><button type="button" onClick={()=>setEditing(null)}>Cancel</button><button type="submit" className="qty-primary">{busy?'Saving…':'Save correction'}</button></div>
      </fieldset>
    </form>}
    <section className="qty-panel qty-history">
      <label className="qty-field"><span>Record type</span><select value={kind} disabled={busy} onChange={event=>{setEditing(null);setKind(event.target.value as Kind);}}>
        <option value="vendors">Outside vendors</option><option value="products">Office product categories</option>
      </select></label>
      {!data && !error && <p role="status">Loading Office records…</p>}
      {data && !data[kind].length && <p>No saved records for this selection.</p>}
      <ul>{data?.[kind].map(row=><li key={row.id} className="qty-history-line">
        <div><strong>{row.name}</strong><small>{fields[kind].filter(field=>field!=='name'&&row[field]).map(field=>row[field]).join(' · ')}</small></div>
        <button type="button" disabled={busy} onClick={()=>{setEditing(row);setError('');setNotice('');}}>Edit details</button>
      </li>)}</ul>
    </section>
    {!!data?.audit.length && <section className="qty-panel qty-outstanding"><h2>Office record changes</h2>
      <ul>{data.audit.map(row=><li key={row.id}><span><strong>{row.target_label}</strong>
        <small>{row.actor} · {row.actor_role} · {new Date(row.created_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</small></span></li>)}</ul>
    </section>}
  </>;
}
