import {defaultIncentiveRule,type IncentiveRule,type OfficeDocument} from './office-core';

type Employee={id:string;user_id:string|null;role:string;manager_id:string|null;joining_date?:string;conversion_target:number;retention_target:number};
type Lead={id:string;created_by:string;created_on:string};
export type OfficeReward={document:string;date:string;employee:string;amount:number;reason:string};
export type OfficeTarget={employee:string;week:string;conversions:number;conversionRate:number;retentionRate:number;penaltyPercent:number;ownerReview:boolean};
const weekStart=(day:string)=>{const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);};
function split(amount:number,role:string,first=false,milestone=false){
 if(first||role==='Office Manager')return [amount,0,0];
 if(role==='Assistant Manager')return [milestone?Math.max(0,amount-1000):Math.round(amount*.8),0,milestone?Math.min(1000,amount):amount-Math.round(amount*.8)];
 if(role==='Office Staff'){
  if(milestone)return [Math.max(0,amount-2000),Math.min(1000,amount),Math.min(1000,Math.max(0,amount-1000))];
  const self=Math.round(amount*.6),assistant=Math.round(amount*.2);return [self,assistant,amount-self-assistant];
 }
 return [amount,0,0];
}
export function officeRewards(documents:OfficeDocument[],employees:Employee[],leads:Lead[],rule:IncentiveRule=defaultIncentiveRule){
 const employeeByUser=new Map(employees.filter(e=>e.user_id).map(e=>[e.user_id!,e]));
 const employeeById=new Map(employees.map(e=>[e.id,e]));
 const settled=documents.filter(d=>d.kind==='bill'&&!d.voided_at&&d.status==='settled'&&d.total>0&&d.paid>=d.total)
  .sort((a,b)=>a.date.localeCompare(b.date)||a.number.localeCompare(b.number));
 const returned=new Map<string,number>();
 for(const doc of documents.filter(d=>d.kind==='return'&&!d.voided_at))for(const line of doc.body.lines){const key=(doc.original_bill||'')+':'+line.id;returned.set(key,(returned.get(key)||0)+line.quantity);}
 const customerDays=new Map<string,string>(),conversions=new Map<string,number>(),rewards:OfficeReward[]=[];
 const add=(doc:OfficeDocument,employee:Employee|undefined,amount:number,reason:string)=>{if(employee&&amount>0)rewards.push({document:doc.id,date:doc.date,employee:employee.id,amount,reason});};
 for(const doc of settled){const seller=employeeByUser.get(doc.actor_id);if(!seller)continue;
  const net=(l:typeof doc.body.lines[number])=>Math.max(0,l.quantity-(returned.get(doc.id+':'+l.id)||0));
  if(!doc.body.lines.some(l=>net(l)>0))continue;
  const firstDate=customerDays.get(doc.customer),first=!firstDate;
  if(!firstDate)customerDays.set(doc.customer,doc.date);
  const normal=doc.body.lines.filter(l=>l.incentiveClass==='normal').reduce((n,l)=>n+net(l),0);
  const low=doc.body.lines.filter(l=>l.incentiveClass==='low').reduce((n,l)=>n+net(l),0);
  const lowAmount=doc.body.lines.filter(l=>l.incentiveClass==='low').reduce((n,l)=>n+net(l)*l.lowIncentive,0);
  const eligible=normal+low,prior=conversions.get(seller.id)||0;
  if(first)conversions.set(seller.id,prior+1);
  if(!eligible||first&&prior<rule.firstConversions||!first&&firstDate===doc.date)continue;
  const boss=employeeById.get(seller.manager_id||''),upper=boss&&employeeById.get(boss.manager_id||'');
  const allocate=(amount:number,reason:string,firstReward=false,milestone=false)=>{const [own,assistant,manager]=split(amount,seller.role,firstReward,milestone);const managerTarget=seller.role==='Office Staff'?(upper||boss):boss;add(doc,seller,own+(boss?0:assistant)+(managerTarget?0:manager),reason);add(doc,boss,assistant,reason+' · team share');add(doc,managerTarget,manager,reason+' · manager share');};
  if(first){if(normal<1||eligible<rule.newMinimumPieces)continue;allocate(rule.newCustomer,'New customer',true);const steps=Math.floor(Math.max(0,eligible-rule.newMinimumPieces)/5);for(let n=0;n<steps;n++)allocate(rule.newExtraPerFive,'New order extra 5 pcs');}
  else{for(let n=0;n<Math.ceil(eligible/5);n++)allocate(rule.repeatPerFive,'Repeat order 5 pcs');}
  if(lowAmount)allocate(lowAmount,'Lower incentive products');
  if(eligible>=10)allocate(rule.tenPieceBonus,'10 pcs milestone',false,true);
  if(eligible>=20)allocate(rule.nextTenBonus,'20 pcs milestone',false,true);
 }
 const targets:OfficeTarget[]=[],today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'}),thisWeek=weekStart(today);
 for(const employee of employees){if(!employee.user_id)continue;
  const firstActivity=[employee.joining_date,...settled.filter(d=>d.actor_id===employee.user_id).map(d=>d.date),...leads.filter(l=>l.created_by===employee.user_id).map(l=>l.created_on)].filter(Boolean).sort()[0]||today;
  let week=weekStart(firstActivity),streak=0,steps=0;
  while(week<=thisWeek&&steps++<520){const weekEnd=new Date(new Date(week+'T00:00:00Z').getTime()+6*864e5).toISOString().slice(0,10);
   const created=leads.filter(l=>l.created_by===employee.user_id&&l.created_on>=week&&l.created_on<=weekEnd);
   const sold=settled.filter(d=>d.actor_id===employee.user_id&&d.date>=week&&d.date<=weekEnd);
   const newCustomers=new Set(sold.filter(d=>customerDays.get(d.customer)===d.date).map(d=>d.customer));
   const repeats=new Set(sold.filter(d=>customerDays.get(d.customer)!==d.date).map(d=>d.customer));
   const conversionRate=created.length?Math.round(newCustomers.size/created.length*100):0;
   const retentionRate=sold.length?Math.round(repeats.size/new Set(sold.map(d=>d.customer)).size*100):0;
   const miss=!!((employee.conversion_target&&conversionRate<employee.conversion_target)||(employee.retention_target&&retentionRate<employee.retention_target));
   const penaltyPercent=Math.min(100,streak*rule.weeklyPenaltyPercent);
   if(week<thisWeek)streak=miss?streak+1:0;
   targets.push({employee:employee.id,week,conversions:newCustomers.size,conversionRate,retentionRate,penaltyPercent,ownerReview:streak>=4});
   week=new Date(new Date(week+'T00:00:00Z').getTime()+7*864e5).toISOString().slice(0,10);
  }
 }
 const penalties=new Map(targets.map(t=>[t.employee+':'+t.week,t.penaltyPercent]));
 for(const reward of rewards){const penalty=penalties.get(reward.employee+':'+weekStart(reward.date))||0;reward.amount=Math.round(reward.amount*(100-penalty)/100);}
 return {rewards,targets};
}
