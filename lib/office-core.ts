import { accountKey, type Account, type Delta } from './production';

export const officeDay=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
export const officeRoles=['Admin','Management','Office Manager','Assistant Manager','Office Staff','Production Manager'];
export const sellingRoles=['Admin','Management','Office Manager','Assistant Manager','Office Staff'];
export const returnReasons=['Colour mismatch','Quality issue','Not satisfied','FULL DISPUTE','PARTIALLY DISPUTE','CASH RETURN'] as const;
export type ReturnReason=typeof returnReasons[number];
export type OfficeLine={id:string;product:string;name:string;quantity:number;unit:number;hsn:string;sku:string;source?:Account;dispatched:number;paymentReceived:boolean;profit:number};
export type OfficeDocumentBody={customer:{id:string;name:string;business_name:string;phone:string;address:string;gst:string};lines:OfficeLine[];layout:Record<string,string>;gst:boolean;cgstRate:number;sgstRate:number;igstRate:number;discount:number;additional:number;notes:string;advance:boolean;deadline:string;paymentMethod:string;replacement?:{product:string;name:string;quantity:number;unit:number;source?:Account};loss:number;signatures?:{creatorName:string;creatorRole:string;creatorImage:string;managerName:string;managerImage:string}};
export type OfficeDocument={id:string;kind:'bill'|'return';number:string;date:string;customer:string;actor_id:string;gst:boolean;body:OfficeDocumentBody;stock_delta:Delta[];total:number;paid:number;revision:number;status:'open'|'settled';original_bill:string|null;return_reason:string;voided_at:string|null};
export const validOfficeDate=(input:unknown,future=false)=>{const date=String(input||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||(!future&&date>officeDay()))throw Error('Choose a valid date.');return date;};
export const officePaise=(input:unknown,label='Amount')=>{const value=typeof input==='string'&&input.trim()?Number(input):input;if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e9||Math.abs(value*100-Math.round(value*100))>0.0001)throw Error('Check '+label+'.');return Math.round(value*100);};
export const officeQuantity=(input:unknown)=>{const n=Number(input);if(!Number.isSafeInteger(n)||n<1||n>1_000_000)throw Error('Enter a whole quantity above zero.');return n;};
export const trimOffice=(value:unknown,max:number,label:string,required=false)=>{const result=typeof value==='string'?value.trim():'';if(result.length>max||(required&&!result))throw Error('Check '+label+'.');return result;};
export const officeFYear=(date:string)=>Number(date.slice(0,4))-(date.slice(5,7)<'04'?1:0);
export const officeNumber=(series:string,year:number,n:number)=>series+'-'+String(year).slice(-2)+'-'+String(n).padStart(4,'0');
export const officeTax=(subtotal:number,discount:number,additional:number,cgstRate:number,sgstRate:number,igstRate:number)=>{const taxable=subtotal-discount+additional;if(taxable<0)throw Error('Discount exceeds bill amount.');const tax=(rate:number)=>Math.round(taxable*rate/10000);return {subtotal,taxable,cgst:tax(cgstRate),sgst:tax(sgstRate),igst:tax(igstRate),total:taxable+tax(cgstRate)+tax(sgstRate)+tax(igstRate)};};
export const officeReturnLoss=(reason:ReturnReason,saleValue:number)=>Math.round(saleValue*({'FULL DISPUTE':90,'PARTIALLY DISPUTE':50,'CASH RETURN':20} as Record<string,number>)[reason]/100)||0;
export const netOfficeDeltas=(deltas:Delta[])=>{const rows=new Map<string,Delta>();for(const delta of deltas){const key=accountKey(delta);rows.set(key,{...delta,quantity:(rows.get(key)?.quantity||0)+delta.quantity});}return [...rows.values()].filter(row=>row.quantity);};
