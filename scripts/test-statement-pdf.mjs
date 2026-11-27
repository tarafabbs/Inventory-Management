// Regression: the vendored browser build exports createPdf on window directly.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source=await readFile(new URL('../lib/statement-pdf.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports={};
let scriptSource='',downloaded='',created=false;
const window={};
const document={
 createElement(tag){
  if(tag==='script')return {set src(value){scriptSource=value;},remove(){}};
  return {set download(value){downloaded=value;},click(){},remove(){}};
 },
 head:{appendChild(script){window.createPdf=()=>({getBlob(callback){created=true;callback(new Blob(['%PDF-1.3']));}});script.onload();}},
 body:{appendChild(){}},
};
const context={exports,window,document,Blob,URL,btoa,AbortSignal,
 fetch:async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([1]).buffer}),
 setTimeout:()=>1,clearTimeout:()=>{},
};
vm.runInNewContext(code,context);
const doc={title:'Statement',subtitle:'Example',generated:'Today',metrics:[],notes:[],sections:[]};
await exports.downloadStatementPdf(doc,'statement.pdf');
assert.equal(scriptSource,'/vendor/pdfmake/pdfmake-0.2.20.min.js');
assert.equal(downloaded,'statement.pdf');
assert.ok(created,'PDF generation must use the loaded browser export');
console.log('PASS: statement PDF loads the vendored engine and starts a download.');
