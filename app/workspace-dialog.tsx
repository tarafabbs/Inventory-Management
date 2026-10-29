'use client';
import React,{useEffect,useId,useRef} from 'react';
import {X} from 'lucide-react';
let openDialogs=0,originalOverflow='';

export default function WorkspaceDialog({title,labelledBy,children,close,wide=false,drawer=false,busy=false}:any){
 const ref=useRef<HTMLElement>(null),closeRef=useRef(close),busyRef=useRef(busy),id=useId();
 closeRef.current=close;busyRef.current=busy;
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;
  if(openDialogs===0)originalOverflow=document.body.style.overflow;
  openDialogs++;document.body.style.overflow='hidden';if(!ref.current?.contains(document.activeElement))ref.current?.focus();
  const key=(event:KeyboardEvent)=>{
   const dialogs=document.querySelectorAll('[data-workspace-dialog]');
   if(dialogs[dialogs.length-1]!==ref.current)return;
   if(event.key==='Escape'){event.preventDefault();if(!busyRef.current)closeRef.current();return}
   if(event.key!=='Tab')return;
   const nodes=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],summary,[tabindex="0"]')||[]).filter(node=>node.getClientRects().length>0);
   if(!nodes.length){event.preventDefault();return}
   const first=nodes[0],last=nodes[nodes.length-1],active=document.activeElement;
   if(event.shiftKey&&(active===first||active===ref.current)){event.preventDefault();last.focus()}
   else if(!event.shiftKey&&(active===last||active===ref.current)){event.preventDefault();first.focus()}
  };
  document.addEventListener('keydown',key);
  return()=>{document.removeEventListener('keydown',key);openDialogs--;if(openDialogs===0)document.body.style.overflow=originalOverflow;if(previous?.isConnected)previous.focus();else document.querySelector<HTMLElement>('.workspace-search-launch, .mobile-workshop-actions button:nth-child(2)')?.focus()};
 },[]);
 return <div className={'overlay '+(drawer?'drawer-overlay':'')} onMouseDown={event=>{if(event.target===event.currentTarget&&!busyRef.current)closeRef.current()}}><section ref={ref} data-workspace-dialog role="dialog" aria-modal="true" aria-labelledby={labelledBy||id} aria-busy={busy} tabIndex={-1} className={drawer?'drawer':'modal '+(wide?'wide':'')}>{title&&<div className="modal-heading"><h2 id={id}>{title}</h2><button type="button" className="icon-btn" aria-label="Close dialog" disabled={busy} onClick={close}><X size={20}/></button></div>}{drawer?children:<div className="modal-body">{children}</div>}</section></div>;
}
