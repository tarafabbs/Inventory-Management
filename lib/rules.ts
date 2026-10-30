export const roles = ['Viewer','Receiving','Issue','Inspection','Office Staff','Assistant Manager','Supervisor','Office Manager','Admin'];
export const officeRoles = ['Office Staff','Assistant Manager','Office Manager'];
export const workshopStaffRoles = ['Receiving','Issue','Inspection','Supervisor'];
export const officeAssignableRoles = ['Office Staff','Assistant Manager'];
export const isOfficeRole = (role:string) => officeRoles.includes(role);
export const isWorkshopStaffRole = (role:string) => workshopStaffRoles.includes(role);
const withinWindow=(createdAt:string,at:number,milliseconds:number)=>{const created=Date.parse(createdAt),age=at-created;return Number.isFinite(created)&&Number.isFinite(at)&&age>=0&&age<=milliseconds;};
export function canEditPreparedReceipt(role:string,createdAt:string,at=Date.now()){if(role==='Admin')return true;return isWorkshopStaffRole(role)&&withinWindow(createdAt,at,24*60*60*1000);}
export function canEditOfficeEntry(role:string,createdAt:string,at=Date.now()){if(role==='Admin')return true;return ['Office Manager','Assistant Manager'].includes(role)&&withinWindow(createdAt,at,24*60*60*1000);}
export const canManageUser = (actorRole:string,targetRole:string|null,nextRole:string) => actorRole==='Admin' ? roles.includes(nextRole) : actorRole==='Office Manager' && (!targetRole||officeAssignableRoles.includes(targetRole)) && officeAssignableRoles.includes(nextRole);
export const artisanWorkTypes=['Free Hand Paint','Kalamkari','Batik Paint','Eco Print','Momchitra','Alcohol Paint','Block Print','Screen Print','Block Batik Print','Mix Dye','Sibori Dye','Pigment Block','Cotton Batik','Others'];
export const privileges=[
 'read','receipt','label','print','draft','masterCreate','master','recovery','undoScan','exceptionReport','check',
 'handoff','return','dispute','supplierReturn','groundSend','finishReceive','reprintOut','reprintReceive','postFinish',
 'exception','reverse','adjust','reprint','backfillThanwala','officeEntry','officeLabel','officeReceive','officeSell','officeReturn','officeEdit','officeMaster','user','settings','adminData'
];
const workshopShared=['read','receipt','label','print','masterCreate','recovery','undoScan','exceptionReport','check','backfillThanwala'];
const officeShared=['read','officeLabel','officeReceive','officeSell','officeReturn','recovery','undoScan'];
const rolePrivileges:Record<string,ReadonlySet<string>>={
 Viewer:new Set(['read']),
 Receiving:new Set([...workshopShared,'draft','supplierReturn','groundSend','finishReceive','postFinish','dispute']),
 Issue:new Set([...workshopShared,'handoff','draft','dispute','groundSend','reprintOut','supplierReturn','postFinish']),
 Inspection:new Set([...workshopShared,'return','draft','dispute','finishReceive','reprintReceive','reprintOut','supplierReturn','postFinish']),
 Supervisor:new Set([...workshopShared,'draft','master','handoff','return','dispute','supplierReturn','groundSend','finishReceive','reprintOut','reprintReceive','postFinish','exception','reverse','adjust','reprint','backfillThanwala']),
 'Office Staff':new Set(officeShared),
 'Assistant Manager':new Set([...officeShared,'officeEntry','officeEdit','officeMaster']),
 'Office Manager':new Set([...officeShared,'officeEntry','officeEdit','officeMaster','user']),
 Admin:new Set(privileges)
};
export function permitted(role:string,op:string){return Object.prototype.hasOwnProperty.call(rolePrivileges,role)&&rolePrivileges[role].has(op);}

type AccessUser={id?:string;name?:string;role:string};
const correctionWindow=20*60*1000;
const stateObject=(value:any)=>{if(value&&typeof value==='object'&&!Array.isArray(value))return value;try{const parsed=JSON.parse(value);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null;}catch{return null;}};
function ownsRecord(user:AccessUser,record:any,event?:any){
 // Modern transactions use immutable user IDs; actor-name matching is only for legacy events.
 if(record?.created_by)return !!user.id&&record.created_by===user.id;
 return !!user.name&&(record?.actor||event?.actor)===user.name;
}
export function canReverseTransaction(user:AccessUser,tx:any,at=Date.now()){
 if(!user||!tx||tx.status!=='CONFIRMED'||!['HANDOFF','RETURN'].includes(tx.type))return false;
 if(['Admin','Supervisor'].includes(user.role))return true;
 const privilege=tx.type==='HANDOFF'?'handoff':'return';
 return isWorkshopStaffRole(user.role)&&permitted(user.role,privilege)&&ownsRecord(user,tx)&&withinWindow(tx.created_at,at,correctionWindow);
}
const workshopCorrections:Record<string,string>={LABEL_CONFIRMED:'label',INTAKE:'label',HANDOFF:'handoff',RETURN:'return',DISPUTE:'dispute',ARTIST_TRANSFER:'handoff',GROUND_ISSUE:'groundSend',GROUND_DISPUTE:'dispute',STOCK_DISPUTE:'dispute',REPRINT_OUT:'reprintOut',REPRINT_RECEIVE:'reprintReceive',FINISH_RECEIVE:'finishReceive',JOBWORK_DISPATCH:'postFinish',JOBWORK_DISPUTE_RETURN:'postFinish',OFFICE_SEND:'postFinish',FACTORY_DISPUTE_RECEIVE:'postFinish'};
const workshopBoundaryStates:Record<string,[string,string]>={JOBWORK_DISPATCH:['IN_HOUSE','JOBWORK_COMPANY'],JOBWORK_DISPUTE_RETURN:['JOBWORK_COMPANY','IN_HOUSE'],OFFICE_SEND:['IN_HOUSE','OFFICE_PENDING'],FACTORY_DISPUTE_RECEIVE:['FACTORY_RETURN_PENDING','IN_HOUSE']};
const officeCorrections:Record<string,string>={OFFICE_LABEL_CONFIRM:'officeLabel',OFFICE_RECEIVE:'officeReceive',OFFICE_SALE:'officeSell'};
const factoryHolders=new Set(['IN_HOUSE','WITH_ARTISAN','GROUND_STAFF','EXCEPTION']);
const officeHolders=new Set(['OFFICE_PENDING','OFFICE_STOCK','SOLD']);
export function canUndoMovement(user:AccessUser,piece:any,event:any,tx:any=null,at=Date.now()){
 if(!user||!piece||!event||!permitted(user.role,'undoScan')||!withinWindow(event.created_at,at,correctionWindow))return false;
 if(event.piece_id&&event.piece_id!==piece.id)return false;
 if(tx&&(tx.status!=='CONFIRMED'||tx.type!==event.type))return false;
 const before=stateObject(event.before_state),after=stateObject(event.after_state),type=tx?.type||event.type;
 if(!after||(!before&&type!=='INTAKE')||!Number.isInteger(piece.version)||piece.version!==after.version||piece.holder!==after.holder)return false;
 if(after.journey&&piece.journey!==after.journey)return false;
 const admin=user.role==='Admin',supervisor=user.role==='Supervisor',officeManager=['Office Manager','Assistant Manager'].includes(user.role);
 if(officeCorrections[type]){
  if(!admin&&!isOfficeRole(user.role))return false;
  if(!admin&&!officeManager&&!ownsRecord(user,tx,event))return false;
  return permitted(user.role,officeCorrections[type])&&officeHolders.has(piece.holder)&&officeHolders.has(before.holder)&&officeHolders.has(after.holder);
 }
 if(!admin&&!supervisor&&!ownsRecord(user,tx,event))return false;
 if(!workshopCorrections[type]||(!admin&&!isWorkshopStaffRole(user.role))||piece.journey==='OFFICE'||before?.journey==='OFFICE'||after.journey==='OFFICE')return false;
 if(!permitted(user.role,workshopCorrections[type]))return false;
 const boundary=workshopBoundaryStates[type];
 if(boundary)return !!before&&before.holder===boundary[0]&&after.holder===boundary[1];
 return factoryHolders.has(piece.holder)&&(!before?type==='INTAKE'&&piece.holder==='IN_HOUSE':factoryHolders.has(before.holder))&&factoryHolders.has(after.holder);
}
export function scanError(p:any,type:string,artisan:string,rework=false){if(!p)return 'Unknown piece ID. Check the barcode or record an unidentified piece exception.';if(type==='return'&&p.condition==='REPRINTING')return 'Use Receive Reprint Scan for this saree.';if(type==='return')return p.holder!=='WITH_ARTISAN'||p.artisan_id!==artisan?`${p.code} is not with the selected artisan.`:'';if(type==='label')return p.condition!=='PENDING_LABEL_CONFIRMATION'?`${p.code} already has a confirmed label.`:'';if(p.holder!=='IN_HOUSE')return `${p.code} is ${p.holder==='WITH_ARTISAN'?'already with an artisan':'in a location exception'}.`;if(p.condition==='PENDING_LABEL_CONFIRMATION')return `${p.code}: scan-confirm the label before handoff.`;if(!['AVAILABLE','ACCEPTED_WORK',...(rework?['NEEDS_REWORK']:[])].includes(p.condition))return `${p.code} is ${p.condition.toLowerCase().replaceAll('_',' ')}${p.condition==='NEEDS_REWORK'?'; enable an explicit rework handoff':''}.`;return '';}
export function quantities(v:any){for(const k of ['stated','accepted','damaged','rejected'])if(!Number.isInteger(v[k])||v[k]<0)throw Error(`${k} must be a nonnegative whole number.`);if(v.accepted>400)throw Error('A receipt supports up to 400 accepted pieces. Split larger arrivals into separate documented lots.');return v.stated-v.accepted-v.damaged-v.rejected;}
export function normalCode(s:string){return s.trim().toUpperCase();}
export function uniqueLines(lines:any[]){if(!Array.isArray(lines)||!lines.length)throw Error('Scan at least one piece.');if(lines.length>100)throw Error('Process up to 100 pieces per transaction.');if(new Set(lines.map(x=>x.id)).size!==lines.length)throw Error('Duplicate piece in transaction.');}
