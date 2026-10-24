'use client';
import React,{useEffect,useRef,useState} from 'react';
import {Camera,ScanLine,X} from 'lucide-react';

export default function ScannerInput({onScan,disabled=false}: {onScan:(code:string,source:string)=>void;disabled?:boolean}){
 const [code,setCode]=useState(''),[camera,setCamera]=useState(false),[error,setError]=useState('');
 const video=useRef<HTMLVideoElement>(null),input=useRef<HTMLInputElement>(null),callback=useRef(onScan);callback.current=onScan;
 useEffect(()=>{if(!camera||disabled)return;let disposed=false,controls:any=null,claimed=false;setError('');
  import('@zxing/browser').then(async({BrowserMultiFormatReader})=>{
   if(disposed||!video.current)return;
   const reader=new BrowserMultiFormatReader();
   controls=await reader.decodeFromConstraints({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}},video.current,(result,_err,ctl)=>{
    if(!result||disposed||claimed)return;claimed=true;ctl.stop();setCamera(false);callback.current(result.getText(),'camera');
   });
   if(disposed||claimed)controls.stop();
  }).catch((e:any)=>{if(!disposed){setError(e.name==='NotAllowedError'?'Camera permission was denied. Allow camera access in your browser, or use a barcode scanner.':e.name==='NotFoundError'?'No camera found. Connect a camera or use a barcode scanner.':'Camera could not start. Close other camera apps, use HTTPS, and try again.');setCamera(false)}});
  return()=>{disposed=true;controls?.stop();const stream=video.current?.srcObject as MediaStream|null;stream?.getTracks().forEach(t=>t.stop());};
 },[camera,disabled]);
 return <div className="scanner-device"><div className="scanner-device-actions"><span><ScanLine size={16}/>USB / Bluetooth scanner · Enter to scan</span><button type="button" className="btn" disabled={disabled} onClick={()=>{setError('');setCamera(!camera)}}><Camera size={16}/>{camera?'Close camera':'Scan with camera'}</button></div>
 <form onSubmit={e=>{e.preventDefault();if(!disabled&&code.trim()){onScan(code.trim().toUpperCase(),'scanner');setCode('');input.current?.focus()}}}><div className="scan-input"><ScanLine size={22}/><input ref={input} aria-label="Scan barcode" autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={disabled} value={code} onChange={e=>setCode(e.target.value)} placeholder="Scan barcode or type Piece Code"/><button className="btn primary" disabled={disabled||!code.trim()}>Scan</button></div></form>
 {camera&&!disabled&&<div className="camera-preview"><video ref={video} muted playsInline autoPlay aria-label="Barcode camera preview"/><p>Point the rear camera at one barcode. Scanning pauses for inspection.</p><button className="btn" type="button" onClick={()=>setCamera(false)}><X size={15}/>Stop camera</button></div>}
 {error&&<p role="alert" className="form-error">{error}</p>}
 </div>;
}
