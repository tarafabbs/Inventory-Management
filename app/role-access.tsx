'use client';
import {useState} from 'react';
import {CheckCircle2,Clock,LockKeyhole,ShieldCheck} from 'lucide-react';
import {isOfficeRole,permitted,roles} from '../lib/rules';
import './role-access.css';

const roleDuties:Record<string,string>={
 Viewer:'Review stock, reports and barcode history without changing records.',
 Receiving:'Receive incoming stock, prepare labels and complete warehouse receiving.',
 Issue:'Send work to artists, arrange transfers and prepare reprint work.',
 Inspection:'Receive artist deliveries, inspect conditions and receive completed reprints.',
 Supervisor:'Run workshop operations and handle documented stock corrections.',
 'Office Staff':'Receive office products, confirm attached labels, record sales and process eligible returns.',
 'Assistant Manager':'Run office operations and manage outside-vendor entries and office record corrections.',
 'Office Manager':'Manage office operations, office records and the permitted office team roles.',
 Admin:'Control the complete workshop and office system, staff access and data recovery.'
};
const capabilities=[
 {title:'Daily work',items:[
  ['receipt','New Entry'],['label','Scan In'],['print','Print labels'],['handoff','Out to Artist'],['return','Artist Delivery'],['dispute','Damage / Dispute'],['groundSend','Scan to Ground Staff'],['finishReceive','Finished Goods Received'],['reprintOut','Out Scan for Reprint'],['reprintReceive','Receive Reprint Scan'],['supplierReturn','Return to Origin'],['postFinish','Company despatch & factory returns'],['officeEntry','Office New Entry'],['officeLabel','Confirm New Office Label'],['officeReceive','Factory Finished Goods Received'],['officeSell','Sold Out'],['officeReturn','Office and customer dispute returns'],['check','Stock checks']
 ]},
 {title:'Self-service support',items:[
  ['masterCreate','Create companies, Thanwalas, products and artisans'],['recovery','Barcode Recovery'],['undoScan','Undo your recent scan'],['exceptionReport','Report an exception'],['backfillThanwala','Add a missing legacy Thanwala'],['officeEdit','Correct Office New Entry details'],['officeMaster','Correct office vendor and product details']
 ]},
 {title:'Management & corrections',items:[
  ['master','Manage existing workshop records'],['adjust','Correct piece custody'],['reverse','Reverse eligible artist transactions'],['exception','Resolve exceptions'],['user','Manage staff access'],['settings','Workspace preferences'],['adminData','Data control']
 ]}
];

export default function RoleAccess({role,allRoles=false}:{role:string;allRoles?:boolean}){
 const [selected,setSelected]=useState(role);
 const current=allRoles?selected:role,can=(op:string)=>permitted(current,op),office=isOfficeRole(current);
 const visible=capabilities.map(group=>({...group,items:group.items.filter(([op])=>can(op))})).filter(group=>group.items.length>0);
 return <section className="panel role-access"><div className="role-access-heading"><span className="role-access-icon"><ShieldCheck size={22}/></span><div><h2>{allRoles?'Role permissions':'My access'}</h2><p>{allRoles?'Choose a role to see the tasks its current permissions allow.':'These tasks are available with your current role.'}</p></div>{allRoles&&<label className="role-access-select"><span>View role</span><select aria-label="View role permissions" value={selected} onChange={event=>setSelected(event.target.value)}>{roles.map(name=><option key={name} value={name}>{name}</option>)}</select></label>}</div><div className="role-access-body"><div className="role-access-summary"><b>{current}</b><p>{roleDuties[current]||'No operational permissions are assigned to this role.'}</p></div>{visible.length?<div className="role-capability-groups">{visible.map(group=><section key={group.title}><h3>{group.title}</h3><ul>{group.items.map(([op,label])=><li key={op}><CheckCircle2 size={15}/><span>{label}</span></li>)}</ul></section>)}</div>:<div className="role-readonly"><LockKeyhole size={20}/><div><b>Read-only access</b><p>You can search and review the records visible to you. Saving, scanning movements and corrections are unavailable.</p></div></div>}<div className="role-access-limits"><h3><Clock size={16}/>Timing & boundaries</h3><ul>{can('receipt')&&current!=='Admin'&&<li>Workshop New Entries can be edited within 24 hours. Scanned identities and recorded movements stay protected.</li>}{can('officeEdit')&&current!=='Admin'&&<li>Office New Entry bill, receipt date and notes can be corrected within 24 hours.</li>}{can('undoScan')&&<li>Your own recent scan can be undone within 20 minutes only if no later movement has changed the product.</li>}{can('backfillThanwala')&&<li>A missing Thanwala on legacy Own Product stock can be added once, with a correction reason.</li>}{['Office Manager','Assistant Manager'].includes(current)&&<li>Office managers can also correct eligible office team scans within the same 20-minute window.</li>}{current==='Supervisor'&&<li>Supervisor can review workshop team scans and reverse unchanged artist transactions with a recorded reason.</li>}{office&&<li>Office access stays within office inventory and its history. Workshop work is completed by Factory Staff.</li>}{current==='Office Manager'&&can('user')&&<li>You can manage only Office Staff and Assistant Manager access.</li>}{current!=='Admin'&&<li>Full system settings, unrestricted staff access and bulk data controls remain with Admin.</li>}{current==='Admin'&&<li>Admin entry edits have no time limit. Data Control undo is available for five hours after a change.</li>}<li>Every saved movement and correction keeps its dated history.</li></ul></div></div></section>;
}
