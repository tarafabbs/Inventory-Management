import type {StatementDocument} from './statement-document';
type PdfMake={createPdf:(definition:unknown,layouts?:unknown,fonts?:unknown,vfs?:unknown)=>{getBlob:(callback:(blob:Blob)=>void)=>void}};
declare global {interface Window {pdfMake?:PdfMake}}
let loading:Promise<PdfMake>|undefined;
function pdfEngine(){
 if(window.pdfMake)return Promise.resolve(window.pdfMake);
 if(!loading)loading=new Promise<PdfMake>((resolve,reject)=>{
  const script=document.createElement('script');script.src='/vendor/pdfmake/pdfmake-0.2.20.min.js';script.async=true;
  const timer=setTimeout(()=>{script.remove();loading=undefined;reject(Error('PDF engine took too long to load. Please retry.'));},30000);
  script.onload=()=>{clearTimeout(timer);if(window.pdfMake)resolve(window.pdfMake);else{loading=undefined;reject(Error('Could not load PDF engine.'));}};
  script.onerror=()=>{clearTimeout(timer);script.remove();loading=undefined;reject(Error('Could not load PDF engine.'));};document.head.appendChild(script);
 });return loading;
}
let fontFiles:Promise<Record<string,string>>|undefined;
function fonts(){
 if(!fontFiles)fontFiles=Promise.all(['Regular','Bold'].flatMap(weight=>['Bengali','Latin'].map(async family=>{
  const filename=family==='Bengali'?`HindSiliguri-${weight}.ttf`:`NotoSans-${weight}.ttf`,response=await fetch('/fonts/'+(family==='Bengali'?'hind-siliguri/':'noto-sans/')+filename,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Could not load the PDF font.');const bytes=new Uint8Array(await response.arrayBuffer());let binary='';for(let at=0;at<bytes.length;at+=8192)binary+=String.fromCharCode(...bytes.subarray(at,at+8192));return [filename,btoa(binary)] as const;
 }))).then(entries=>Object.fromEntries(entries)).catch(e=>{fontFiles=undefined;throw e;});return fontFiles;
}
// Preserve Bengali shaping and use a consistent Latin face for English text.
function scriptRuns(text:string){
 const runs:{text:string;font:string}[]=[];
 for(const char of Array.from(text.replace(/[\u2011\u2013\u2014]/g,'-'))){
  const font=/[\u0964\u0965\u0980-\u09ff\u200c\u200d]/.test(char)?'Bengali':'Latin',last=runs[runs.length-1];
  if(last?.font===font)last.text+=char;else runs.push({text:char,font});
 }
 return runs.length?runs:[{text:'',font:'Latin'}];
}
function fontNodes(node:unknown):unknown{
 if(Array.isArray(node))return node.map(fontNodes);
 if(typeof node==='function')return (...args:unknown[])=>fontNodes(node(...args));
 if(node&&typeof node==='object')return Object.fromEntries(Object.entries(node).map(([key,value])=>[key,key==='text'&&typeof value==='string'?scriptRuns(value):fontNodes(value)]));
 return node;
}
export function statementPdfDefinition(doc:StatementDocument){
 return fontNodes({pageBreakBefore:(node:{headlineLevel?:number;startPosition?:{verticalRatio?:number}})=>node.headlineLevel===1&&(node.startPosition?.verticalRatio||0)>.7,pageSize:'A4',pageOrientation:'landscape',pageMargins:[30,44,30,36],info:{title:doc.title,author:'IMS TARA MAA',subject:doc.subtitle},defaultStyle:{font:'Latin',fontSize:8,color:'#29223a',lineHeight:1.25},styles:{title:{fontSize:18,bold:true,color:'#6542a1',margin:[0,0,0,8]},section:{fontSize:12,bold:true,color:'#6542a1',margin:[0,16,0,6]},note:{fontSize:8,color:'#665a75',margin:[0,4,0,8]}},header:()=>({text:'IMS TARA MAA  |  '+doc.subtitle,margin:[30,16,30,0],fontSize:8,color:'#766981'}),footer:(page:number,count:number)=>({columns:[{text:doc.generated},{text:`${page} / ${count}`,alignment:'right'}],margin:[30,10,30,0],fontSize:7,color:'#766981'}),content:[{text:doc.title,style:'title'},{text:doc.subtitle,margin:[0,0,0,10]},{table:{widths:['*','*','*'],body:Array.from({length:Math.ceil(doc.metrics.length/3)},(_,i)=>Array.from({length:3},(_,j)=>{const m=doc.metrics[i*3+j];return m?{stack:[{text:m.label,fontSize:8},{text:m.value,bold:true,fontSize:12}],fillColor:'#f2edf8',margin:[7,6,7,6]}:{text:''};}))},layout:'noBorders'},...doc.notes.map(text=>({text,style:'note'})),...doc.sections.flatMap(s=>[{text:s.title,style:'section',headlineLevel:1},...(s.note?[{text:s.note,style:'note'}]:[]),s.rows.length?{table:{headerRows:1,widths:s.headers.map(()=>'*'),body:[s.headers.map(text=>({text,bold:true,color:'#ffffff',fillColor:'#6542a1'})),...s.rows.map((row,i)=>row.map(text=>({text,fillColor:i%2?'#f7f4fb':'#ffffff'})))]},layout:{hLineWidth:()=>0.4,vLineWidth:()=>0.4,hLineColor:()=>'#ded5e9',vLineColor:()=>'#ded5e9',paddingLeft:()=>5,paddingRight:()=>5,paddingTop:()=>5,paddingBottom:()=>5}}:{text:'—',style:'note'}])]});
}
export async function downloadStatementPdf(doc:StatementDocument,filename:string){
 const [engine,vfs]=await Promise.all([pdfEngine(),fonts()]);
 const family={Bengali:{normal:'HindSiliguri-Regular.ttf',bold:'HindSiliguri-Bold.ttf',italics:'HindSiliguri-Regular.ttf',bolditalics:'HindSiliguri-Bold.ttf'},Latin:{normal:'NotoSans-Regular.ttf',bold:'NotoSans-Bold.ttf',italics:'NotoSans-Regular.ttf',bolditalics:'NotoSans-Bold.ttf'}};
 const blob=await new Promise<Blob>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('PDF generation took too long. Please retry.')),45000);try{engine.createPdf(statementPdfDefinition(doc),undefined,family,vfs).getBlob(blob=>{clearTimeout(timer);resolve(blob);});}catch(e){clearTimeout(timer);reject(e);}});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
