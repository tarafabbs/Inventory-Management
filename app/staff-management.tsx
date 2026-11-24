'use client';
import {useInventoryLanguage} from '@/app/inventory-language';

import {useEffect, useState, type FormEvent} from 'react';
import {Plus,ShieldCheck} from 'lucide-react';
import {roleLabel,roles} from '@/lib/rules';

type Member = {id:string;name:string;email:string;role:string;active:number};
type Change = {id:string;actor:string;actor_role:string;target_label:string;created_at:string;
  before_data?:Member;after_data?:Member;action:string};
type StaffData = {staff:Member[];audit:Change[]};
const newMember:Member={id:'',name:'',email:'',role:'Viewer',active:1};

export default function StaffManagement({currentUser,request,save}: {
  currentUser:string;
  request:(url:string,init?:RequestInit)=>Promise<StaffData>;
  save:(values:Record<string,unknown>)=>Promise<unknown>;
}) {
    const {t:tr}=useInventoryLanguage();

  const [data,setData]=useState<StaffData|null>(null);
  const [member,setMember]=useState<Member|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [search,setSearch]=useState('');

  async function load(signal?:AbortSignal) {
    try {
      const result=await request('/api/ledger?staff=1',{signal});
      if (!signal?.aborted) setData(result);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Could not load staff.');
    }
  }
  useEffect(()=>{
    const controller=new AbortController();
    void load(controller.signal);
    return ()=>controller.abort();
  },[]);

  function open(record:Member) {
    setError('');setNotice('');setMember({...record});
  }
  async function submit(event:FormEvent) {
    event.preventDefault();
    if (!member || busy) return;
    setBusy(true);setError('');setNotice('');
    try {
      await save({...member,active:!!member.active});
      setMember(null);setNotice('Staff access was saved.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save staff access.');
    } finally {
      setBusy(false);
    }
  }

  const current=member?.id===currentUser;
  const filtered=data?.staff.filter(row=>[row.name,row.email,roleLabel(row.role),tr(roleLabel(row.role))].join(' ').toLowerCase().includes(search.trim().toLowerCase())) || [];
  return <>
    <div className="qty-title"><div><h1>{tr("Staff Access")}</h1><p>{tr("Add approved Google emails and choose which work each person can do.")}</p></div>
      <button className="qty-primary" type="button" disabled={busy||!data} onClick={()=>open(newMember)}><Plus size={17}/>{tr("Add staff")}</button></div>
    {error && <p className="qty-status bad" role="alert">{tr(error)}</p>}
    {notice && <p className="qty-status" role="status">{tr(notice)}</p>}
    {member && <form className="qty-panel qty-form qty-staff-form" onSubmit={submit}>
      <fieldset disabled={busy}>
        <h2>{member.id ? tr("Manage access") : tr("New staff access")}</h2>
        <div className="qty-fields">
          <label className="qty-field"><span>{tr("Full name")}</span><input autoFocus required value={member.name} maxLength={120} onChange={event=>setMember({...member,name:event.target.value})}/></label>
          <label className="qty-field"><span>{tr("Google email")}</span><input type="email" required readOnly={!!member.id} value={member.email} maxLength={254} onChange={event=>setMember({...member,email:event.target.value})}/></label>
          <label className="qty-field"><span>{tr("Role")}</span><select disabled={current} value={member.role} onChange={event=>setMember({...member,role:event.target.value})}>
            {roles.map(role=><option key={role} value={role}>{tr(roleLabel(role))}</option>)}
          </select></label>
        </div>
        {member.id && <label className="qty-checkbox"><input type="checkbox" disabled={current} checked={!!member.active} onChange={event=>setMember({...member,active:event.target.checked?1:0})}/>{tr("Active access")}</label>}
        <div className="qty-quick"><button type="button" onClick={()=>setMember(null)}>{tr("Cancel")}</button>
          <button type="submit" className="qty-primary">{busy ? tr("Saving…") : tr("Save access")}</button></div>
      </fieldset>
    </form>}
    <section className="qty-panel qty-history">
      <label className="qty-field"><span>{tr("Find staff")}</span><input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder={tr("Name, Google email or role")}/></label>
      {!data && !error && <p role="status">{tr("Loading staff…")}</p>}
      {data && !filtered.length && <p>{tr("No matching staff.")}</p>}
      <ul>{filtered.map(row=><li key={row.id} className="qty-history-line">
        <div><strong>{row.name}</strong><small>{row.email}</small></div>
        <div><b>{tr(roleLabel(row.role))} · {row.active ? tr("Active") : tr("Inactive")}</b><button type="button" disabled={busy} onClick={()=>open(row)}>{tr("Manage access")}</button></div>
      </li>)}</ul>
    </section>
    {!!data?.audit.length && <section className="qty-panel qty-outstanding"><h2>{tr("Access history")}</h2><ul>{data.audit.map(row=><li key={row.id}>
      <span><strong>{row.target_label}</strong><small>{row.actor} · {tr(row.actor_role)} · {new Date(row.created_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}</small></span>
      <span><ShieldCheck size={15}/> {row.action==='staff_added' ? tr("Added") : tr("Updated")}{row.after_data ? " · " + (roleLabel(row.after_data.role)) + " · " + (row.after_data.active?'Active':'Inactive') : ''}</span>
    </li>)}</ul></section>}
  </>;
}
