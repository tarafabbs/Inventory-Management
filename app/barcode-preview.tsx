import { barcode } from '../lib/barcode';

export default function BarcodePreview({code,className='barcode'}:{code:string;className?:string}){
 const symbol=barcode(code);
 return <svg viewBox={`0 0 ${symbol.width} 58`} className={className} role="img" aria-label={`Code 128 barcode for ${code}`} preserveAspectRatio="xMidYMid meet" shapeRendering="crispEdges"><rect width={symbol.width} height="58" fill="white"/>{symbol.bars.map((bar,index)=><rect key={index} x={bar.x} y="2" width={bar.w} height="39" fill="#17202b"/>)}<text x={symbol.width/2} y="54" textAnchor="middle" fontSize="9" fontFamily="monospace" letterSpacing="1">{code}</text></svg>
}
