'use client';

import React,{useMemo,useState} from 'react';
import {ArrowDownRight,ArrowUpRight,Clock3,PackageCheck,TrendingUp,TriangleAlert,UsersRound} from 'lucide-react';
import {artisanPerformance,ratingClass} from '../lib/artisan-performance';
import './business-intelligence.css';
import './artisan-performance.css';

const DAY=86_400_000;
const movementTypes={
 artist:['RETURN','REPRINT_RECEIVE'],
 finished:['FINISH_RECEIVE'],
 outbound:['OFFICE_SALE','JOBWORK_DISPATCH'],
 disputes:['DISPUTE','GROUND_DISPUTE','STOCK_DISPUTE','OFFICE_DISPUTE_RETURN','CUSTOMER_DISPUTE_RETURN','JOBWORK_DISPUTE_RETURN'],
 assignment:['HANDOFF','ARTIST_TRANSFER','REPRINT_OUT'],
};
const activeOutside=new Set(['RETURNED_TO_SOURCE','JOBWORK_COMPANY','SOLD']);
const colors=['#8873d2','#b399de','#79a994','#d9ad68','#c97d75'];

function lines(tx:any){try{const parsed=JSON.parse(tx.snapshot);return Array.isArray(parsed)?parsed:[]}catch{return []}}
function countMovements(transactions:any[],types:string[],start:number,end:number){return transactions.filter(t=>t.status==='CONFIRMED'&&types.includes(t.type)&&Date.parse(t.created_at)>=start&&Date.parse(t.created_at)<end).reduce((sum,t)=>sum+lines(t).length,0)}
function change(current:number,previous:number){if(!previous)return current?{text:'New activity'}:{text:'No change'};const percent=Math.round((current-previous)/previous*100);return {text:`${Math.abs(percent)}% vs previous`,percent}}
function compact(n:number){return n.toLocaleString('en-IN')}
function periodLabel(start:number,end:number){const f=(n:number)=>new Date(n).toLocaleDateString('en-IN',{day:'2-digit',month:'short'});return `${f(start)} – ${f(end-1)}`}

function KpiCard({label,value,previous,detail,invert=false,unit=''}:any){const delta=change(value,previous),good=invert?value<=previous:value>=previous;return <article className="bi-kpi"><div className="bi-kpi-top"><span>{label}</span>{good?<ArrowUpRight size={16}/>:<ArrowDownRight size={16}/>}</div><strong>{compact(value)}{unit}</strong><div className={'bi-delta '+(good?'good':'bad')}>{delta.text}</div><small>{detail}</small></article>}

export default function BusinessIntelligence({d}:any){
 const [days,setDays]=useState(30);
 const intelligence=useMemo(()=>{
  const end=Date.now()+1000,start=end-days*DAY,previousStart=start-days*DAY;
  const confirmed=(d.transactions||[]).filter((t:any)=>t.status==='CONFIRMED');
  const lots=(d.lots||[]).filter((l:any)=>l.status!=='DRAFT');
  const accepted=(a:number,b:number)=>lots.filter((l:any)=>{const at=Date.parse(l.received_at);return at>=a&&at<b}).reduce((sum:number,l:any)=>sum+Number(l.accepted||0),0);
  const period={received:accepted(start,end),artist:countMovements(confirmed,movementTypes.artist,start,end),finished:countMovements(confirmed,movementTypes.finished,start,end),outbound:countMovements(confirmed,movementTypes.outbound,start,end),disputes:countMovements(confirmed,movementTypes.disputes,start,end)};
  const previous={received:accepted(previousStart,start),artist:countMovements(confirmed,movementTypes.artist,previousStart,start),finished:countMovements(confirmed,movementTypes.finished,previousStart,start),outbound:countMovements(confirmed,movementTypes.outbound,previousStart,start),disputes:countMovements(confirmed,movementTypes.disputes,previousStart,start)};
  const active=(d.pieces||[]).filter((p:any)=>!activeOutside.has(p.holder));
  const assignments=new Map<string,number>();
  [...confirmed].sort((a:any,b:any)=>Date.parse(a.created_at)-Date.parse(b.created_at)).forEach((t:any)=>{if(!movementTypes.assignment.includes(t.type))return;for(const row of lines(t))assignments.set(row.id,Date.parse(t.created_at))});
  const artisanPieces=active.filter((p:any)=>p.holder==='WITH_ARTISAN');
  const age=(p:any)=>Math.max(0,Math.floor((end-(assignments.get(p.id)||Date.parse(p.created_at)))/DAY));
  const overdue=artisanPieces.filter((p:any)=>age(p)>7),critical=artisanPieces.filter((p:any)=>age(p)>14);
  const attention=active.filter((p:any)=>['NEEDS_REWORK','DAMAGED','DISPUTED'].includes(p.condition));
  const categoryNames=['In-house ready','With artisans','Finishing / reprint','Office stock','Attention / pending'];
  const categoryOf=(p:any)=>{
   if(['PENDING_LABEL_CONFIRMATION','NEEDS_REWORK','DAMAGED','DISPUTED'].includes(p.condition)||p.holder==='EXCEPTION')return 'Attention / pending';
   if(['OFFICE_PENDING','OFFICE_STOCK'].includes(p.holder))return 'Office stock';
   if(p.holder==='GROUND_STAFF'||['FINISHING','REPRINTING'].includes(p.condition))return 'Finishing / reprint';
   if(p.holder==='WITH_ARTISAN')return 'With artisans';
   return 'In-house ready';
  };
  const categoryCounts=active.reduce((map:any,p:any)=>{const key=categoryOf(p);map[key]=(map[key]||0)+1;return map},{});
  const categories=categoryNames.map(name=>({name,value:categoryCounts[name]||0}));
  const total=Math.max(1,categories.reduce((sum,item)=>sum+item.value,0));let cursor=0;
  const donut=categories.map((item,index)=>{const from=cursor,to=cursor+item.value/total*100;cursor=to;return `${colors[index]} ${from}% ${to}%`}).join(', ');
  const bucketDays=Math.max(1,Math.ceil(days/6));
  const buckets=Array.from({length:6},(_,index)=>{const bucketStart=start+index*bucketDays*DAY,bucketEnd=Math.min(end,bucketStart+bucketDays*DAY);return {label:new Date(bucketStart).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}),received:accepted(bucketStart,bucketEnd),artist:countMovements(confirmed,movementTypes.artist,bucketStart,bucketEnd),outbound:countMovements(confirmed,[...movementTypes.finished,...movementTypes.outbound],bucketStart,bucketEnd)}});
  const maxBucket=Math.max(1,...buckets.flatMap(bucket=>[bucket.received,bucket.artist,bucket.outbound]));
  const artisans=(d.artisans||[]).filter((a:any)=>a.active).map((artisan:any)=>{const issued=countMovements(confirmed.filter((t:any)=>t.artisan_id===artisan.id),['HANDOFF','ARTIST_TRANSFER','REPRINT_OUT'],start,end),performance=artisanPerformance(artisan.id,confirmed,{start,end}),outstanding=artisanPieces.filter((p:any)=>p.artisan_id===artisan.id),late=outstanding.filter((p:any)=>age(p)>7).length;return {id:artisan.id,name:artisan.name,issued,returned:performance.delivered,averageDays:performance.averageDays,rating:performance.rating,outstanding:outstanding.length,late}}).sort((a:any,b:any)=>b.returned-a.returned||b.outstanding-a.outstanding).slice(0,6);
  const topReturn=Math.max(1,...artisans.map((a:any)=>a.returned));
  const companyMap=new Map<string,number>();for(const p of active)companyMap.set(p.company_id,(companyMap.get(p.company_id)||0)+1);
  const companies=[...companyMap].map(([id,value])=>({id,name:(d.companies||[]).find((c:any)=>c.id===id)?.name||'Unknown source',value})).sort((a,b)=>b.value-a.value).slice(0,5);
  const topCompany=Math.max(1,...companies.map(item=>item.value));
  return {start,end,previousStart,period,previous,active,artisanPieces,overdue,critical,attention,categories,donut,buckets,maxBucket,artisans,topReturn,companies,topCompany};
 },[d,days]);
 const completed=intelligence.period.artist+intelligence.period.finished+intelligence.period.outbound;
 const previousCompleted=intelligence.previous.artist+intelligence.previous.finished+intelligence.previous.outbound;
 const disputeRate=completed?Math.round(intelligence.period.disputes/completed*1000)/10:0;
 const previousDisputeRate=previousCompleted?Math.round(intelligence.previous.disputes/previousCompleted*1000)/10:0;
 return <section className="bi-section" aria-labelledby="business-kpi-title">
  <div className="bi-heading"><div><span>BUSINESS GROWTH</span><h2 id="business-kpi-title">Performance command center</h2><p>Live operational health with a like-for-like comparison against the previous period.</p></div><label>Compare period<select value={days} onChange={e=>setDays(Number(e.target.value))}><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={180}>Last 180 days</option></select></label></div>
  <div className="bi-periods"><span><b>Current</b>{periodLabel(intelligence.start,intelligence.end)}</span><span><b>Previous</b>{periodLabel(intelligence.previousStart,intelligence.start)}</span></div>
  <div className="bi-kpi-grid"><KpiCard label="Pieces received" value={intelligence.period.received} previous={intelligence.previous.received} detail="Accepted across confirmed receipts"/><KpiCard label="Artist output" value={intelligence.period.artist} previous={intelligence.previous.artist} detail="Artist delivery and reprint receipts"/><KpiCard label="Finished / outbound" value={intelligence.period.finished+intelligence.period.outbound} previous={intelligence.previous.finished+intelligence.previous.outbound} detail="Finished goods, sales and despatches"/><KpiCard label="Dispute rate" value={disputeRate} previous={previousDisputeRate} detail={`${intelligence.period.disputes} disputed pieces in this period`} invert unit="%"/></div>
  <div className="bi-health-grid"><div><PackageCheck size={18}/><span>Active inventory<strong>{compact(intelligence.active.length)}</strong></span></div><div><UsersRound size={18}/><span>Work in progress<strong>{compact(intelligence.artisanPieces.length)}</strong></span></div><div><Clock3 size={18}/><span>Over 7 days<strong>{compact(intelligence.overdue.length)}</strong></span></div><div className={intelligence.critical.length?'attention':''}><TriangleAlert size={18}/><span>Over 14 days<strong>{compact(intelligence.critical.length)}</strong></span></div><div className={intelligence.attention.length?'attention':''}><TrendingUp size={18}/><span>Rework / damage<strong>{compact(intelligence.attention.length)}</strong></span></div></div>
  <div className="bi-chart-grid"><article className="panel bi-trend"><div className="panel-heading"><div><h2>Throughput trend</h2><p>How work is entering, returning and reaching finished/sold stages.</p></div><div className="bi-legend"><span><i className="received"/>Received</span><span><i className="artist"/>Artist output</span><span><i className="outbound"/>Finished / outbound</span></div></div><div className="bi-bars" role="img" aria-label="Throughput comparison across six time buckets">{intelligence.buckets.map((bucket:any)=><div className="bi-bucket" key={bucket.label}><div className="bi-column"><i className="received" style={{height:`${bucket.received/intelligence.maxBucket*100}%`}} data-value={bucket.received}/><i className="artist" style={{height:`${bucket.artist/intelligence.maxBucket*100}%`}} data-value={bucket.artist}/><i className="outbound" style={{height:`${bucket.outbound/intelligence.maxBucket*100}%`}} data-value={bucket.outbound}/></div><span>{bucket.label}</span></div>)}</div></article>
   <article className="panel bi-donut-panel"><div className="panel-heading"><div><h2>Inventory position</h2><p>Where every active piece is right now.</p></div></div><div className="bi-donut-wrap"><div className="bi-donut" style={{background:`conic-gradient(${intelligence.donut})`}} role="img" aria-label={`Active inventory ${intelligence.active.length} pieces`}><span><strong>{compact(intelligence.active.length)}</strong>active</span></div><div className="bi-donut-legend">{intelligence.categories.map((item:any,index:number)=><div key={item.name}><i style={{background:colors[index]}}/><span>{item.name}</span><b>{compact(item.value)}</b></div>)}</div></div></article></div>
  <div className="bi-chart-grid secondary"><article className="panel"><div className="panel-heading"><div><h2>Artisan delivery performance</h2><p>Rated by average saree turnaround: 1 week Excellent, 2 Good, 3 Bad, 4+ Very bad.</p></div></div><div className="bi-ranking">{intelligence.artisans.map((artisan:any)=><div className="bi-rank" key={artisan.id}><div><b>{artisan.name}</b><small>{artisan.returned} returned · {artisan.outstanding} outstanding · {artisan.late} overdue</small><em className={'bi-rating '+ratingClass(artisan.rating)}>{artisan.rating}{artisan.averageDays!==null?` · ${artisan.averageDays} day avg`:''}</em></div><span><i style={{width:`${artisan.returned/intelligence.topReturn*100}%`}}/></span><strong>{artisan.returned}</strong></div>)}{!intelligence.artisans.length&&<p className="empty">No artisan activity in this period.</p>}</div></article>
   <article className="panel"><div className="panel-heading"><div><h2>Inventory by source</h2><p>Largest company/vendor concentration in current active stock.</p></div></div><div className="bi-ranking sources">{intelligence.companies.map((company:any)=><div className="bi-rank" key={company.id}><div><b>{company.name}</b><small>{Math.round(company.value/intelligence.active.length*100)||0}% of active inventory</small></div><span><i style={{width:`${company.value/intelligence.topCompany*100}%`}}/></span><strong>{company.value}</strong></div>)}{!intelligence.companies.length&&<p className="empty">No active inventory source data.</p>}</div></article></div>
 </section>;
}
