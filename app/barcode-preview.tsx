export default function CodePreview({code,className='barcode',color='#17202b'}:{code:string;className?:string;color?:string}){
 return <div className={className} role="img" aria-label={`Handwritten inventory code ${code}`} style={{display:'grid',placeItems:'center',minHeight:'58px',background:'#fff',color,border:'2px solid currentColor',borderRadius:'8px',fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace',fontWeight:800,fontSize:'clamp(24px,4vw,42px)',letterSpacing:'.18em',paddingLeft:'.18em'}}>{code}</div>
}
