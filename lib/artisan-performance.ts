const DAY=86_400_000;
const assignmentTypes=new Set(['HANDOFF','REPRINT_OUT']);
const deliveryTypes=new Set(['RETURN','REPRINT_RECEIVE']);

function rows(transaction:any){
 try{const parsed=JSON.parse(transaction.snapshot);return Array.isArray(parsed)?parsed:[]}catch{return []}
}

export function turnaroundRating(days:number|null){
 if(days===null)return 'Not rated';
 if(days<=7)return 'Excellent';
 if(days<=14)return 'Good';
 if(days<=21)return 'Bad';
 return 'Very bad';
}

export function ratingClass(rating:string){return rating.toLowerCase().replaceAll(' ','-')}

export function artisanPerformance(artisanId:string,transactions:any[],range?:{start?:number;end?:number}){
 const openAssignments=new Map<string,number>();
 const deliveryDays:number[]=[];
 const confirmed=[...transactions].filter(transaction=>transaction.status==='CONFIRMED').sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));
 for(const transaction of confirmed){
  const at=Date.parse(transaction.created_at);
  const pieces=rows(transaction);
  if(transaction.type==='ARTIST_TRANSFER'){
   for(const piece of pieces){
    const fromId=piece.from_artisan_id||piece.artisan_id;
    const toId=transaction.artisan_id||piece.to_artisan_id;
    if(fromId===artisanId)openAssignments.delete(piece.id);
    if(toId===artisanId)openAssignments.set(piece.id,at);
   }
   continue;
  }
  if(assignmentTypes.has(transaction.type)&&transaction.artisan_id===artisanId){
   for(const piece of pieces)openAssignments.set(piece.id,at);
   continue;
  }
  if(deliveryTypes.has(transaction.type)&&transaction.artisan_id===artisanId){
   for(const piece of pieces){
    const issuedAt=openAssignments.get(piece.id);
    if(issuedAt===undefined)continue;
    openAssignments.delete(piece.id);
    if(range?.start!==undefined&&at<range.start||range?.end!==undefined&&at>=range.end)continue;
    deliveryDays.push(Math.max(0,Math.ceil((at-issuedAt)/DAY)));
   }
  }
 }
 const averageDays=deliveryDays.length?Math.round(deliveryDays.reduce((sum,days)=>sum+days,0)/deliveryDays.length*10)/10:null;
 const distribution={Excellent:0,Good:0,Bad:0,'Very bad':0};
 for(const days of deliveryDays)distribution[turnaroundRating(days) as keyof typeof distribution]++;
 return {delivered:deliveryDays.length,averageDays,rating:turnaroundRating(averageDays),distribution};
}
