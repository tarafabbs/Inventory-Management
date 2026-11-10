'use client';
import React,{useEffect,useId,useRef,useState} from 'react';
import {Camera,CircleHelp,Hash,History,LoaderCircle,X} from 'lucide-react';
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
 knownCodes?:string[];
};

const cleanCode=(value:string)=>value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);
let workerPromise:Promise<any>|null=null;
let reportOcrProgress:((status:string,progress:number)=>void)|null=null;

export function codeCandidates(text:string,knownCodes:string[]=[]){
 const lines=text.toUpperCase().split(/\r?\n/).map(cleanCode).filter(Boolean);
 const tokens=(text.toUpperCase().match(/[A-Z0-9]{1,4}/g)||[]).map(cleanCode);
 const candidates=[...new Set([...lines,...tokens])].filter(code=>code.length>=1&&code.length<=4);
 const known=new Set(knownCodes.map(cleanCode));
 const exact=candidates.filter(code=>known.has(code));
 return exact.length?exact:candidates;
}

async function preparePhoto(file:File){
 const bitmap=await createImageBitmap(file),scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
 const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('This browser could not prepare the tag photo.');
 context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
 const pixels=context.getImageData(0,0,canvas.width,canvas.height);
 for(let i=0;i<pixels.data.length;i+=4){const gray=.299*pixels.data[i]+.587*pixels.data[i+1]+.114*pixels.data[i+2],boost=Math.max(0,Math.min(255,(gray-128)*1.45+128));pixels.data[i]=boost;pixels.data[i+1]=boost;pixels.data[i+2]=boost}
 context.putImageData(pixels,0,0);return canvas.toDataURL('image/jpeg',.92);
}

async function recognizePhoto(file:File,onProgress:(status:string,progress:number)=>void){
 reportOcrProgress=onProgress;
 if(!workerPromise)workerPromise=import('tesseract.js').then(async({createWorker,PSM})=>{const worker=await createWorker('eng',1,{logger:(message:any)=>reportOcrProgress?.(message.status||'Reading tag',Number(message.progress||0))});await worker.setParameters({tessedit_char_whitelist:'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',tessedit_pageseg_mode:PSM.SINGLE_WORD,preserve_interword_spaces:'0'});return worker});
 const [worker,image]=await Promise.all([workerPromise,preparePhoto(file)]),result=await worker.recognize(image);return String(result.data?.text||'');
}

export default function ScannerInput({onScan,onHistory,onUnreadable,disabled=false,historyDisabled=false,damagedMode=false,label,placeholder,knownCodes=[]}:Props){
 const [code,setCode]=useState(''),[error,setError]=useState(''),[history,setHistory]=useState(false),[reading,setReading]=useState(false),[progress,setProgress]=useState('');
 const id=useId(),input=useRef<HTMLInputElement>(null),photo=useRef<HTMLInputElement>(null);
 const effectiveDisabled=history?historyDisabled:disabled;
 useEffect(()=>{if(effectiveDisabled)return;const frame=requestAnimationFrame(()=>input.current?.focus({preventScroll:true}));return()=>cancelAnimationFrame(frame)},[effectiveDisabled,history]);

 async function submit(){
  const normalized=cleanCode(code);
  if(!normalized)return;
  if((normalized.length<1||normalized.length>4)&&!damagedMode){setError('Enter the complete 1–4 character code written on the tag.');return}
  if(history&&onHistory){const found=await onHistory(normalized);setError(found===false?'No saved history exists for this code. Check the tag and try again.':'')}
  else await onScan(normalized,'manual');
  setCode('');input.current?.focus();
 }

 async function readPhoto(file?:File){
  if(!file)return;setReading(true);setError('');setProgress('Preparing photo…');
  try{const text=await recognizePhoto(file,(status,value)=>setProgress(`${status} · ${Math.round(value*100)}%`)),matches=codeCandidates(text,knownCodes);if(!matches.length)throw Error('No clear 1–4 character code was found. Retake a close, bright photo or type the code.');setCode(matches[0]);setError(matches.length>1?`Recognized ${matches[0]}. Check the tag before Submit; other possible reads: ${matches.slice(1,4).join(', ')}.`:`Recognized ${matches[0]}. Check it against the tag, then press Submit.`);setTimeout(()=>input.current?.focus(),0)}catch(cause:any){workerPromise=null;setError(cause?.message||'The tag photo could not be read. Type the code instead.')}finally{setReading(false);setProgress('');if(photo.current)photo.current.value=''}
 }

 return <div className={'scanner-device'+(history?' history-mode':'')+(damagedMode?' damaged-mode':'')}>
  <div className="scanner-device-actions"><span>{history?<History size={16}/>:<Hash size={16}/>} {history?'History check · enter a saved code':label||(damagedMode?'Find a partially readable tag code':'Type the 1–4 character tag code')}</span><div className="scanner-action-buttons"><input ref={photo} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={event=>void readPhoto(event.target.files?.[0])}/><button type="button" className="btn photo-code-button" disabled={effectiveDisabled||reading} onClick={()=>photo.current?.click()}>{reading?<LoaderCircle className="spin" size={16}/>:<Camera size={16}/>}Photo</button>{onHistory&&<button type="button" className={'btn'+(history?' primary':'')} disabled={historyDisabled} aria-pressed={history} onClick={()=>{setHistory(!history);setError('');setCode('');setTimeout(()=>input.current?.focus(),0)}}><History size={16}/>{history?'History check on':'History check'}</button>}{onUnreadable&&<button type="button" className="btn" disabled={effectiveDisabled} onClick={onUnreadable}><CircleHelp size={16}/>Code missing?</button>}</div></div>
  <form onSubmit={event=>{event.preventDefault();if(!effectiveDisabled&&!reading)void submit()}}><div className="scan-input"><Hash size={22} aria-hidden="true"/><input ref={input} inputMode="text" maxLength={4} aria-label={history?'Enter code to view history':damagedMode?'Enter the readable part of the tag code':'Enter 1 to 4 character tag code'} aria-describedby={id+'-hint'+(error?' '+id+'-error':'')} aria-invalid={!!error} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={effectiveDisabled||reading} value={code} onChange={event=>{setCode(cleanCode(event.target.value));if(error)setError('')}} placeholder={history?'e.g. 7 or A7K3':placeholder||(damagedMode?'Enter visible characters':'e.g. 7, 42 or A7K3')}/>{code&&<button type="button" className="scanner-clear-code" aria-label="Clear code" disabled={effectiveDisabled||reading} onClick={()=>{setCode('');setError('');input.current?.focus()}}><X size={16}/></button>}<button className="btn primary" disabled={effectiveDisabled||reading||!code.trim()}>{history?'View history':damagedMode?'Find code':'Submit'}</button></div><p id={id+'-hint'} className="scanner-input-hint">{reading?progress:history?'History only · inventory stays unchanged.':damagedMode?'Type or photograph the characters that are still readable on the tag.':'Type the tag code or take a close photo. Always check a recognized code before Submit.'}</p></form>
  {error&&<p id={id+'-error'} role="alert" className="form-error">{error}</p>}
 </div>;
}
