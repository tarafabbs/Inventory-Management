'use client';
import React,{useEffect,useRef,useState} from 'react';
import {Camera,History,ScanLine,X} from 'lucide-react';

export default function ScannerInput({onScan,onHistory,disabled=false,historyDisabled=false}: {onScan:(code:string,source:string)=>void;onHistory?:(code:string)=>boolean|void|Promise<boolean|void>;disabled?:boolean;historyDisabled?:boolean}){
 const [code,setCode]=useState(''),[camera,setCamera]=useState(false),[error,setError]=useState(''),[history,setHistory]=useState(false);
 const video=useRef<HTMLVideoElement>(null),input=useRef<HTMLInputElement>(null),callback=useRef(onScan),historyCallback=useRef(onHistory),historyMode=useRef(history);callback.current=onScan;historyCallback.current=onHistory;historyMode.current=history;
 const effectiveDisabled=history?historyDisabled:disabled;
 async function deliver(value:string,source:string){const normalized=value.trim().toUpperCase();if(!normalized)return;if(historyMode.current&&historyCallback.current){const found=await historyCallback.current(normalized);setError(found===false?'No saved history exists for this barcode. Verify the printed code and try again.':'');return}callback.current(normalized,source)}
 useEffect(()=>{if(!camera||effectiveDisabled)return;let disposed=false,controls:any=null,claimed=false;setError('');
  import('@zxing/browser').then(async({BrowserMultiFormatReader})=>{
   if(disposed||!video.current)return;
   const reader=new BrowserMultiFormatReader();
   controls=await reader.decodeFromConstraints({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}},video.current,(result,_err,ctl)=>{
    if(!result||disposed||claimed)return;claimed=true;ctl.stop();setCamera(false);void deliver(result.getText(),'camera');
   });
   if(disposed||claimed)controls.stop();
  }).catch((e:any)=>{if(!disposed){setError(e.name==='NotAllowedError'?'Camera permission was denied. Allow camera access in your browser, or use a barcode scanner.':e.name==='NotFoundError'?'No camera found. Connect a camera or use a barcode scanner.':'Camera could not start. Close other camera apps, use HTTPS, and try again.');setCamera(false)}});
  return()=>{disposed=true;controls?.stop();const stream=video.current?.srcObject as MediaStream|null;stream?.getTracks().forEach(t=>t.stop());};
 },[camera,effectiveDisabled]);
 return <div className={'scanner-device'+(history?' history-mode':'')}><div className="scanner-device-actions"><span>{history?<History size={16}/>:<ScanLine size={16}/>} {history?'History check active · scan any saved barcode':'USB / Bluetooth scanner · Enter to scan'}</span><div className="scanner-action-buttons">{onHistory&&<button type="button" className={'btn'+(history?' primary':'')} disabled={historyDisabled} aria-pressed={history} onClick={()=>{setHistory(!history);setCamera(false);setError('');setCode('');setTimeout(()=>input.current?.focus(),0)}}><History size={16}/>{history?'History check on':'History check'}</button>}<button type="button" className="btn" disabled={effectiveDisabled} onClick={()=>{setError('');setCamera(!camera)}}><Camera size={16}/>{camera?'Close camera':'Scan with camera'}</button></div></div>
 <form onSubmit={e=>{e.preventDefault();if(!effectiveDisabled&&code.trim()){void deliver(code,'scanner');setCode('');input.current?.focus()}}}><div className="scan-input"><ScanLine size={22}/><input ref={input} aria-label={history?'Scan barcode to view history':'Scan barcode'} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={effectiveDisabled} value={code} onChange={e=>setCode(e.target.value)} placeholder={history?'Scan barcode to open its history':'Scan barcode or type Piece Code'}/><button className="btn primary" disabled={effectiveDisabled||!code.trim()}>{history?'View history':'Scan'}</button></div></form>
 {camera&&!effectiveDisabled&&<div className="camera-preview"><video ref={video} muted playsInline autoPlay aria-label="Barcode camera preview"/><p>{history?'Point the rear camera at a barcode to open its saved history.':'Point the rear camera at one barcode. Scanning pauses for inspection.'}</p><button className="btn" type="button" onClick={()=>setCamera(false)}><X size={15}/>Stop camera</button></div>}
 {error&&<p role="alert" className="form-error">{error}</p>}
 </div>;
}
