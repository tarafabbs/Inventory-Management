import type {Balance,Document} from './production';
import type {Event,Master} from './production-types';
export type StatementFilter={scope:'overall'|'company'|'artisan';id:string;from:string;to:string};
export type MoneyEntry={id:string;party:string;date:string;created_at:string;kind:string;base_kind:string;amount:number;reference:string;notes:string;actor:string;event_id?:string|null;reversed?:boolean};
export type RunningEntry=MoneyEntry&{before:number;after:number;increase:number;decrease:number};
export type AmountRow={party:string;amount:number};
export type StatementSource={cutoverDate?:string;companies:Master[];artisans:Master[];products:Master[];balances:Balance[];documents:Document[];events:Event[];companyMoney:MoneyEntry[];artisanMoney:MoneyEntry[];companyOpening:AmountRow[];artisanOpening:AmountRow[];companyTotals:AmountRow[];artisanTotals:AmountRow[]};
export type PartySummary={id:string;name:string;raw:number;artist:number;repaint:number;ready:number;hold:number;returnPending:number;returnArtist:number;returnReady:number;office:number;custody:number;artistCount:number;companyCount:number;due:number;advance:number;damage:number;damagePending:number;companyHeld:number;rawReturned:number};
export type StatementReport={filter:StatementFilter;generatedAt:string;subject:string;companies:Master[];products:Master[];artisans:Master[];stocks:Balance[];disputes:Balance[];documents:Document[];events:Event[];companyRows:PartySummary[];artisanRows:PartySummary[];companyLedger:RunningEntry[];artisanLedger:RunningEntry[];companyPeriod:{party:string;opening:number;closing:number}[];artisanPeriod:{party:string;opening:number;closing:number}[];metrics:{custody:number;ready:number;withArtists:number;dispute:number;damaged:number;unsettledDamage:number;companyDue:number;companyAdvance:number;artisanDue:number;artisanAdvance:number;companyPayments:number;artisanPayments:number;cashRefunds:number};warnings:string[]};
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
export function statementFilter(q:URLSearchParams):StatementFilter{
 const scope=q.get('scope')||'overall',id=q.get('id')||'',from=q.get('from')||'',to=q.get('to')||today();
 if(!['overall','company','artisan'].includes(scope)||(scope!=='overall'&&!id)||id.length>200)throw Error('Choose a valid statement profile.');
 for(const d of [from,to].filter(Boolean))if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||Number.isNaN(Date.parse(d+'T00:00:00Z'))||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d)throw Error('Choose a valid date.');
 if(from&&from>to||to>today())throw Error('Statement dates must be in order and not in the future.');
 return {scope:scope as StatementFilter['scope'],id:scope==='overall'?'':id,from,to};
}
export function runningLedger(entries:MoneyEntry[],opening:AmountRow[]){
 const running=new Map(opening.map(r=>[r.party,Number(r.amount)]));
 const eventOrder=(e:MoneyEntry)=>e.base_kind==='stock_correction'?0:e.base_kind==='charge'?1:e.base_kind==='payment'?2:3;
 const rows=[...entries].sort((a,b)=>a.date.localeCompare(b.date)||a.created_at.localeCompare(b.created_at)||(a.event_id||a.id).localeCompare(b.event_id||b.id)||eventOrder(a)-eventOrder(b)||a.id.localeCompare(b.id)).map(r=>{
  const amount=Number(r.amount),before=running.get(r.party)||0,after=before+amount;
  if(!Number.isSafeInteger(amount)||!Number.isSafeInteger(after))throw Error('Statement amounts exceed the supported precise range.');
  running.set(r.party,after);return {...r,amount,before,after,increase:Math.max(0,amount),decrease:Math.max(0,-amount)};
 });
 return {rows,balances:running};
}
const sum=(rows:{quantity:number}[])=>rows.reduce((s,b)=>s+Number(b.quantity),0);
const custodyStages=new Set(['raw','ready','hold','artist','reprint','office_pending','office_stock','office_return']);
function summary(master:Master,rows:Balance[],documents:Document[],due:number):PartySummary{
 const q=(pool:string,stages:string[])=>sum(rows.filter(b=>b.pool===pool&&stages.includes(b.stage)));
 return {id:master.id,name:master.name,raw:q('normal',['raw']),artist:q('normal',['artist']),repaint:q('normal',['reprint']),ready:q('normal',['ready']),hold:q('normal',['hold']),returnPending:q('company_return',['hold']),returnArtist:q('company_return',['artist']),returnReady:q('company_return',['ready']),office:sum(rows.filter(b=>b.stage.startsWith('office_')&&b.stage!=='office_sold')),custody:sum(rows.filter(b=>custodyStages.has(b.stage))),artistCount:new Set(rows.filter(b=>b.artisan&&b.quantity>0).map(b=>b.artisan)).size,companyCount:new Set(rows.filter(b=>b.quantity>0&&custodyStages.has(b.stage)).map(b=>b.company)).size,due:Math.max(0,due),advance:Math.max(0,-due),damage:documents.filter(d=>d.kind==='damage').reduce((s,d)=>s+d.quantity,0),damagePending:documents.filter(d=>d.kind==='damage'&&!d.voided).reduce((s,d)=>s+d.quantity-d.settled,0),companyHeld:sum(rows.filter(b=>b.stage==='delivered')),rawReturned:sum(rows.filter(b=>b.stage==='raw_returned'))};
}
export function buildStatement(source:StatementSource,filter:StatementFilter,generatedAt=new Date().toISOString()):StatementReport{
 if([source.events,source.companyMoney,source.artisanMoney].some(rows=>rows.length>20000))throw Error('This statement is too large. Choose a shorter date range; no entries have been omitted.');
 if(source.cutoverDate&&filter.to<source.cutoverDate)throw Error('This end date is before the inventory cutover. Open Previous History for older stock.');
 const subject=filter.scope==='overall'?'Overall Statement':(filter.scope==='company'?source.companies:source.artisans).find(p=>p.id===filter.id)?.name;
 if(!subject)throw Error('Statement profile no longer exists.');
 const stocks=source.balances.filter(b=>filter.scope==='overall'||filter.scope==='company'&&b.company===filter.id||filter.scope==='artisan'&&b.artisan===filter.id);
 const documents=source.documents.filter(d=>filter.scope==='overall'||filter.scope==='company'&&d.company===filter.id||filter.scope==='artisan'&&d.payload.identifiedArtist===filter.id);
 const companyMoney=filter.scope==='artisan'?[]:source.companyMoney.filter(e=>filter.scope!=='company'||e.party===filter.id),artisanMoney=filter.scope==='company'?[]:source.artisanMoney.filter(e=>filter.scope!=='artisan'||e.party===filter.id);
 const companyOpening=filter.scope==='artisan'?[]:source.companyOpening.filter(e=>filter.scope!=='company'||e.party===filter.id),artisanOpening=filter.scope==='company'?[]:source.artisanOpening.filter(e=>filter.scope!=='artisan'||e.party===filter.id);
 const cm=runningLedger(companyMoney,companyOpening),am=runningLedger(artisanMoney,artisanOpening);
 const period=(masters:Master[],open:AmountRow[],ledger:ReturnType<typeof runningLedger>)=>masters.map(m=>({party:m.id,opening:Number(open.find(r=>r.party===m.id)?.amount||0),closing:ledger.balances.get(m.id)||0}));
 const companies=source.companies.filter(c=>filter.scope==='company'?c.id===filter.id:filter.scope==='artisan'?stocks.some(b=>b.company===c.id):true);
 const artisans=source.artisans.filter(a=>filter.scope==='artisan'?a.id===filter.id:filter.scope==='company'?stocks.some(b=>b.artisan===a.id):true);
 const companyRows=companies.map(c=>summary(c,stocks.filter(b=>b.company===c.id),documents.filter(d=>d.company===c.id),filter.scope==='artisan'?0:Number(source.companyTotals.find(m=>m.party===c.id)?.amount||0)));
 const artisanRows=artisans.map(a=>summary(a,stocks.filter(b=>b.artisan===a.id),documents.filter(d=>d.payload.identifiedArtist===a.id),filter.scope==='company'?0:Number(source.artisanTotals.find(m=>m.party===a.id)?.amount||0)));
 const disputes=stocks.filter(b=>b.pool==='company_return'&&custodyStages.has(b.stage)||b.pool==='normal'&&['hold','reprint'].includes(b.stage));
 const rows=filter.scope==='artisan'?artisanRows:companyRows;
 return {filter,generatedAt,subject,companies:source.companies,products:source.products,artisans:source.artisans,stocks,disputes,documents,events:source.events.filter(e=>filter.scope==='overall'||filter.scope==='company'&&(e.company===filter.id||e.delta.some(d=>d.company===filter.id))||filter.scope==='artisan'&&e.delta.some(d=>d.artisan===filter.id)),companyRows,artisanRows,companyLedger:cm.rows,artisanLedger:am.rows,companyPeriod:period(companies,companyOpening,cm),artisanPeriod:period(artisans,artisanOpening,am),metrics:{custody:rows.reduce((s,r)=>s+r.custody,0),ready:sum(stocks.filter(b=>b.stage==='ready')),withArtists:sum(stocks.filter(b=>['artist','reprint'].includes(b.stage))),dispute:sum(disputes),damaged:documents.filter(d=>d.kind==='damage').reduce((s,d)=>s+d.quantity,0),unsettledDamage:documents.filter(d=>d.kind==='damage'&&!d.voided).reduce((s,d)=>s+d.quantity-d.settled,0),companyDue:companyRows.reduce((s,r)=>s+r.due,0),companyAdvance:companyRows.reduce((s,r)=>s+r.advance,0),artisanDue:artisanRows.reduce((s,r)=>s+r.due,0),artisanAdvance:artisanRows.reduce((s,r)=>s+r.advance,0),companyPayments:-cm.rows.filter(r=>r.base_kind==='payment').reduce((s,r)=>s+r.amount,0),artisanPayments:-am.rows.filter(r=>r.base_kind==='payment').reduce((s,r)=>s+r.amount,0),cashRefunds:am.rows.filter(r=>r.base_kind==='refund').reduce((s,r)=>s+r.amount,0)},warnings:stocks.some(b=>b.quantity<0)?['Backdated entries create a negative historical stock balance. Review the movement dates.']:[]};
}
