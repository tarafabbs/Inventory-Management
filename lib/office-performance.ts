import type {OfficeDocument} from './office-core';

type Employee={id:string;user_id:string|null;joining_date?:string;conversion_target:number;retention_target:number};
type Lead={id:string;created_by:string;created_on:string};
export type EmployeeKpi={employee:string;leadsDay:number;leadsWeek:number;leadsMonth:number;convertedCustomers:number;conversionRate:number;repeatCustomers:number;retentionRate:number;totalSales:number;salesDay:number;salesWeek:number;salesMonth:number};
export type OfficeTarget={employee:string;week:string;leads:number;conversions:number;conversionRate:number;retentionRate:number;sales:number;missed:boolean;ownerReview:boolean};
export const weekStart=(day:string)=>{const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);};
const rate=(a:number,b:number)=>b?Math.round(a/b*100):0;

export function officePerformance(documents:OfficeDocument[],employees:Employee[],leads:Lead[],today:string){
 const bills=documents.filter(d=>d.kind==='bill'&&!d.voided_at&&d.status==='settled');
 const billById=new Map(bills.map(d=>[d.id,d]));
 const customerDates=new Map<string,Set<string>>();
 for(const bill of bills){const days=customerDates.get(bill.customer)||new Set<string>();days.add(bill.date);customerDates.set(bill.customer,days);}
 const returns=documents.filter(d=>d.kind==='return'&&!d.voided_at);
 const week=weekStart(today),month=today.slice(0,7),kpis:EmployeeKpi[]=[],targets:OfficeTarget[]=[];
 for(const employee of employees){if(!employee.user_id)continue;
  const ownedLeads=leads.filter(l=>l.created_by===employee.user_id);
  const sold=bills.filter(d=>d.actor_id===employee.user_id);
  const returned=returns.filter(d=>billById.get(d.original_bill||'')?.actor_id===employee.user_id);
  const converted=(rows:Lead[])=>rows.filter(l=>customerDates.has(l.id));
  const repeated=(rows:Lead[])=>rows.filter(l=>(customerDates.get(l.id)?.size||0)>1);
  const allConverted=converted(ownedLeads);
  const sales=(start:string,end:string)=>sold.filter(d=>d.date>=start&&d.date<=end).reduce((n,d)=>n+d.total,0)+returned.filter(d=>d.date>=start&&d.date<=end).reduce((n,d)=>n+d.total,0);
  kpis.push({employee:employee.id,leadsDay:ownedLeads.filter(l=>l.created_on===today).length,
   leadsWeek:ownedLeads.filter(l=>l.created_on>=week&&l.created_on<=today).length,
   leadsMonth:ownedLeads.filter(l=>l.created_on.startsWith(month)).length,
   convertedCustomers:allConverted.length,conversionRate:rate(allConverted.length,ownedLeads.length),
   repeatCustomers:repeated(allConverted).length,retentionRate:rate(repeated(allConverted).length,allConverted.length),
   totalSales:sales('0000-01-01',today),salesDay:sales(today,today),salesWeek:sales(week,today),salesMonth:sales(month+'-01',today)});
  const first=[employee.joining_date,...ownedLeads.map(l=>l.created_on),...sold.map(d=>d.date)].filter(Boolean).sort()[0]||today;
  let start=weekStart(first),misses=0,steps=0;
  while(start<=week&&steps++<520){const end=new Date(Date.parse(start+'T00:00:00Z')+6*864e5).toISOString().slice(0,10);
   const periodLeads=ownedLeads.filter(l=>l.created_on>=start&&l.created_on<=end),periodConverted=converted(periodLeads);
   const conversionRate=rate(periodConverted.length,periodLeads.length),retentionRate=rate(repeated(periodConverted).length,periodConverted.length);
   const missed=!!(employee.conversion_target&&conversionRate<employee.conversion_target||employee.retention_target&&retentionRate<employee.retention_target);
   if(start<week)misses=missed?misses+1:0;
   targets.push({employee:employee.id,week:start,leads:periodLeads.length,conversions:periodConverted.length,conversionRate,retentionRate,sales:sales(start,end),missed,ownerReview:misses>=4});
   start=new Date(Date.parse(start+'T00:00:00Z')+7*864e5).toISOString().slice(0,10);
  }
 }
 return {kpis,targets};
}
