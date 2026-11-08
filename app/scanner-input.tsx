'use client';
import React,{useEffect,useId,useRef,useState} from 'react';
import {CircleHelp,Hash,History,X} from 'lucide-react';
import './scanner-accessibility.css';

type Props={
 onScan:(code:string,source:string)=>void|Promise<void>;
 onHistory?:(code:string)=>boolean|void|Promise<boolean|void>;
 onUnreadable?:()=>void;
 disabled?:boolean;
 historyDisabled?:boolean;
 damagedMode?:boolean;
 label?:string;
 placeholder?:string;
};

const cleanCode=(value:string)=>value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);

export default function ScannerInput({onScan,onHistory,onUnreadable,disabled=false,historyDisabled=false,damagedMode=false,label,placeholder}:Props){
 const [code,setCode]=useState(''),[error,setError]=useState(''),[history,setHistory]=useState(false);
 const id=useId(),input=useRef<HTMLInputElement>(null);
 const effectiveDisabled=history?historyDisabled:disabled;
 useEffect(()=>{if(effectiveDisabled)return;const frame=requestAnimationFrame(()=>input.current?.focus({preventScroll:true}));return()=>cancelAnimationFrame(frame)},[effectiveDisabled,history]);

 async function submit(){
  const normalized=cleanCode(code);
  if(!normalized)return;
  if(normalized.length!==4&&!damagedMode){setError('Enter the complete 4-character code written on the tag.');return}
  if(history&&onHistory){const found=await onHistory(normalized);setError(found===false?'No saved history exists for this code. Check the tag and try again.':'')}
  else await onScan(normalized,'manual');
  setCode('');input.current?.focus();
 }

 return <div className={'scanner-device'+(history?' history-mode':'')+(damagedMode?' damaged-mode':'')}>
  <div className="scanner-device-actions"><span>{history?<History size={16}/>:<Hash size={16}/>} {history?'History check · enter a saved code':label||(damagedMode?'Find a partially readable tag code':'Type the 4-character tag code')}</span><div className="scanner-action-buttons">{onHistory&&<button type="button" className={'btn'+(history?' primary':'')} disabled={historyDisabled} aria-pressed={history} onClick={()=>{setHistory(!history);setError('');setCode('');setTimeout(()=>input.current?.focus(),0)}}><History size={16}/>{history?'History check on':'History check'}</button>}{onUnreadable&&<button type="button" className="btn" disabled={effectiveDisabled} onClick={onUnreadable}><CircleHelp size={16}/>Code missing?</button>}</div></div>
  <form onSubmit={event=>{event.preventDefault();if(!effectiveDisabled)void submit()}}><div className="scan-input"><Hash size={22} aria-hidden="true"/><input ref={input} inputMode="text" maxLength={4} aria-label={history?'Enter code to view history':damagedMode?'Enter the readable part of the tag code':'Enter 4-character tag code'} aria-describedby={id+'-hint'+(error?' '+id+'-error':'')} aria-invalid={!!error} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={effectiveDisabled} value={code} onChange={event=>{setCode(cleanCode(event.target.value));if(error)setError('')}} placeholder={history?'e.g. A7K3':placeholder||(damagedMode?'Enter 2–4 visible characters':'e.g. A7K3')}/>{code&&<button type="button" className="scanner-clear-code" aria-label="Clear code" disabled={effectiveDisabled} onClick={()=>{setCode('');setError('');input.current?.focus()}}><X size={16}/></button>}<button className="btn primary" disabled={effectiveDisabled||!code.trim()}>{history?'View history':damagedMode?'Find code':'Submit'}</button></div><p id={id+'-hint'} className="scanner-input-hint">{history?'History only · inventory stays unchanged.':damagedMode?'Type the characters that are still readable on the tag.':'Read the tag, type its four characters, then press Submit.'}</p></form>
  {error&&<p id={id+'-error'} role="alert" className="form-error">{error}</p>}
 </div>;
}
