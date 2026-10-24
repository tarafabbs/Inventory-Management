'use client';
import React from 'react';
import {ArrowUpRight} from 'lucide-react';
import {artistWorkRecords} from '../lib/artist-history';

export default function ArtistWorkHistory({piece,d,date,openTransaction}:any){
 const {rounds,artistCount}=artistWorkRecords(piece.id,d.transactions,d.artisans);
 return <section className="timeline-section artist-work-records"><h3>Artists & work rounds</h3><p className="muted">{artistCount} different artists · {rounds.length} work rounds on this saree. Every delivery can be followed by Out to Artist again.</p>
 {rounds.map((r:any,i:number)=><article className="artist-round" key={r.id}><div><strong>{i+1}. {r.artist}</strong><span className="badge gray">{r.status}</span></div><p>{r.work_type}{r.issue.type==='REPRINT_OUT'?' · Reprint / rework':''}</p>{r.description&&<p>{r.description}</p>}<small>Out to Artist: {date(r.issue.created_at,true)}</small><small>{r.delivery?`${r.status}: ${date(r.delivery.created_at,true)}`:'Delivery pending'}</small>{r.delivery_line&&<p>Inspection: {r.delivery_line.outcome||r.status}{r.delivery_line.inspection_reason?' · '+r.delivery_line.inspection_reason:''}</p>}<div className="button-row"><button className="text-btn" onClick={()=>openTransaction(r.issue)}>Issue record<ArrowUpRight size={14}/></button>{r.delivery&&<button className="text-btn" onClick={()=>openTransaction(r.delivery)}>Delivery record<ArrowUpRight size={14}/></button>}</div></article>)}
 {!rounds.length&&<p className="muted">No confirmed artist work recorded for this saree yet.</p>}</section>
}
