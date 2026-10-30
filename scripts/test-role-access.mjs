// Pure authorization checks: no database connection or persistent writes.
// Run: node scripts/test-role-access.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../lib/rules.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {roles,privileges,permitted,canManageUser,canEditPreparedReceipt,canEditOfficeEntry,canReverseTransaction,canUndoMovement}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
let checks=0;
const check=(condition,message)=>{assert.ok(condition,message);checks++;};
const at=Date.parse('2026-10-30T12:00:00Z'),minutesAgo=n=>new Date(at-n*60000).toISOString();
const user=role=>({id:'u1',name:'Current operator',role});
const tx=(type,patch={})=>({id:'t1',type,status:'CONFIRMED',created_at:minutesAgo(5),created_by:'u1',actor:'Current operator',...patch});
const piece=(patch={})=>({id:'p1',version:2,journey:'FACTORY',holder:'IN_HOUSE',...patch});
const event=(type,before,after,patch={})=>({id:'e1',piece_id:'p1',type,actor:'Current operator',created_at:minutesAgo(5),before_state:JSON.stringify(before),after_state:JSON.stringify(after),...patch});
const factoryBefore={id:'p1',version:1,journey:'FACTORY',holder:'IN_HOUSE'},artistAfter={...factoryBefore,version:2,holder:'WITH_ARTISAN'};
const handoff=event('HANDOFF',factoryBefore,artistAfter);

for(const role of roles){
 check(permitted(role,'read'),`${role} can read its scoped workspace`);
 check(!permitted(role,'unknownPrivilege'),`${role} fails closed for unknown privileges`);
 for(const privilege of privileges)if(role==='Viewer')check(privilege==='read'||!permitted(role,privilege),'Viewer has no mutation permissions');
 if(role!=='Admin')for(const privilege of ['adminData','settings'])check(!permitted(role,privilege),`${role} cannot ${privilege}`);
}
for(const privilege of privileges)check(!permitted('Unknown role',privilege),'Unknown roles fail closed');
for(const role of ['constructor','toString','__proto__'])check(!permitted(role,'read'),'Inherited object keys are not roles');
for(const role of ['Receiving','Issue','Inspection','Supervisor']){
 for(const privilege of ['receipt','label','print','masterCreate','recovery','undoScan','exceptionReport','check','backfillThanwala'])check(permitted(role,privilege),`${role} can complete intake and routine self-service`);
 for(const privilege of ['officeEntry','officeLabel','officeReceive','officeSell','officeReturn','officeEdit','officeMaster','user'])check(!permitted(role,privilege),`${role} stays outside office/admin access`);
 check(canEditPreparedReceipt(role,minutesAgo(24*60),at),`${role} retains inclusive24h entry edit window`);
 check(!canEditPreparedReceipt(role,minutesAgo(24*60+1),at),`${role} cannot edit expired entries`);
 check(!canEditPreparedReceipt(role,minutesAgo(-1),at),`${role} rejects future entry timestamps`);
}
for(const role of ['Receiving','Issue','Inspection'])check(!permitted(role,'master'),'Ordinary workshop staff cannot edit/archive shared masters');
check(permitted('Issue','handoff')&&!permitted('Issue','return'),'Issue keeps outgoing artisan duty');
check(permitted('Inspection','return')&&!permitted('Inspection','handoff'),'Inspection keeps delivery duty');
check(permitted('Receiving','dispute'),'Receiving may report a warehouse finding');
for(const privilege of ['master','exception','reverse','adjust','reprint','backfillThanwala'])check(permitted('Supervisor',privilege),`Supervisor supports ${privilege} without admin`);
check(!permitted('Supervisor','seed')&&!permitted('Supervisor','adminData'),'Supervisor allowlist excludes privileged and future actions');
for(const role of ['Office Staff','Assistant Manager','Office Manager']){
 for(const privilege of ['officeLabel','officeReceive','officeSell','officeReturn','recovery','undoScan'])check(permitted(role,privilege),`${role} can complete office scan duties`);
 for(const privilege of ['receipt','label','print','masterCreate','master','handoff','return','groundSend','finishReceive','postFinish','adjust','reverse','check','backfillThanwala'])check(!permitted(role,privilege),`${role} cannot enter workshop controls`);
}
check(!permitted('Office Staff','officeEntry')&&!permitted('Office Staff','officeEdit')&&!permitted('Office Staff','officeMaster'),'Office Staff remains scan-focused');
for(const role of ['Assistant Manager','Office Manager']){
 for(const privilege of ['officeEntry','officeEdit','officeMaster'])check(permitted(role,privilege),`${role} self-services office entries and vendor/product records`);
 check(canEditOfficeEntry(role,minutesAgo(1440),at)&&!canEditOfficeEntry(role,minutesAgo(1441),at),'Office manager edit window is24h');
}
check(canEditOfficeEntry('Admin',minutesAgo(100000),at)&&canEditPreparedReceipt('Admin',minutesAgo(100000),at),'Admin retains lifetime entry edits');
check(!canEditOfficeEntry('Office Staff',minutesAgo(1),at)&&!canEditOfficeEntry('Supervisor',minutesAgo(1),at),'Only office managers or Admin edit office entries');
check(canManageUser('Office Manager',null,'Office Staff')&&canManageUser('Office Manager','Assistant Manager','Office Staff'),'Office Manager keeps subordinate office access control');
check(!canManageUser('Assistant Manager',null,'Office Staff')&&!canManageUser('Office Manager',null,'Supervisor')&&!canManageUser('Office Manager','Admin','Office Staff'),'Office access cannot escalate roles');

check(canReverseTransaction(user('Issue'),tx('HANDOFF'),at),'Issue may reverse its own recent handoff');
check(canReverseTransaction(user('Inspection'),tx('RETURN'),at),'Inspection may reverse its own recent delivery');
check(!canReverseTransaction(user('Receiving'),tx('HANDOFF'),at),'Receiving cannot reverse unassigned artisan duty');
check(!canReverseTransaction(user('Issue'),tx('HANDOFF',{created_by:'other'}),at),'Staff cannot reverse another operator’s transaction');
check(!canReverseTransaction(user('Issue'),tx('HANDOFF',{created_at:minutesAgo(21)}),at),'Staff reverse expires after20min');
check(canReverseTransaction(user('Issue'),tx('HANDOFF',{created_at:minutesAgo(20)}),at),'Staff reverse permits exact20min boundary');
check(!canReverseTransaction(user('Issue'),tx('HANDOFF',{created_at:minutesAgo(-1)}),at),'Future correction timestamp rejected');
check(canReverseTransaction(user('Supervisor'),tx('RETURN',{created_by:'other',created_at:minutesAgo(10000)}),at),'Supervisor can document an older valid artisan reversal');
for(const role of roles)check(!canReverseTransaction(user(role),tx('OFFICE_SALE'),at),'Artisan reversal never becomes office correction');
check(!canReverseTransaction(user('Admin'),tx('HANDOFF',{status:'VOIDED_BY_REVERSAL'}),at),'Already reversed transaction blocked');

check(canUndoMovement(user('Issue'),piece({holder:'WITH_ARTISAN'}),handoff,tx('HANDOFF'),at),'Issue can undo its own current handoff scan');
check(!canUndoMovement(user('Inspection'),piece({holder:'WITH_ARTISAN'}),handoff,tx('HANDOFF'),at),'Inspection cannot undo another duty');
check(!canUndoMovement(user('Issue'),piece({holder:'WITH_ARTISAN'}),handoff,tx('HANDOFF',{created_by:'other'}),at),'Current actor name cannot override a different created_by');
check(!canUndoMovement(user('Issue'),piece({holder:'WITH_ARTISAN',version:3}),handoff,tx('HANDOFF'),at),'Subsequent version blocks undo');
check(!canUndoMovement(user('Issue'),piece({holder:'WITH_ARTISAN'}),{...handoff,created_at:minutesAgo(21)},tx('HANDOFF'),at),'Recent scan undo expires');
check(!canUndoMovement(user('Issue'),piece({holder:'WITH_ARTISAN'}),{...handoff,piece_id:'another'},tx('HANDOFF'),at),'Event must identify current piece');
check(!canUndoMovement(user('Issue'),piece({holder:'WITH_ARTISAN'}),handoff,tx('RETURN'),at),'Mismatched event and transaction types blocked');
check(!canUndoMovement(user('Admin'),piece(),event('INTAKE',null,{holder:'IN_HOUSE'}),tx('INTAKE'),at),'Incomplete intake rollback state is rejected');
check(canUndoMovement(user('Receiving'),piece(),event('INTAKE',null,{...factoryBefore,version:2}),tx('INTAKE'),at),'Versioned first intake permits pending-label restoration without deleting code');
for(const [type,from,to] of [['JOBWORK_DISPATCH','IN_HOUSE','JOBWORK_COMPANY'],['JOBWORK_DISPUTE_RETURN','JOBWORK_COMPANY','IN_HOUSE'],['OFFICE_SEND','IN_HOUSE','OFFICE_PENDING'],['FACTORY_DISPUTE_RECEIVE','FACTORY_RETURN_PENDING','IN_HOUSE']]){
 const movement=event(type,{...factoryBefore,holder:from},{...factoryBefore,version:2,holder:to});
 check(canUndoMovement(user('Receiving'),piece({holder:to}),movement,tx(type),at),'Workshop author may correct its own recent '+type);
 check(!canUndoMovement(user('Receiving'),piece({holder:to}),movement,tx(type,{created_by:'other'}),at),'Workshop cannot correct another author’s boundary scan');
 check(canUndoMovement(user('Supervisor'),piece({holder:to}),movement,tx(type,{created_by:'other'}),at),'Supervisor may correct a recent workshop boundary scan');
 check(!canUndoMovement(user('Receiving'),piece({holder:to}),{...movement,before_state:JSON.stringify({...factoryBefore,holder:'SOLD'})},tx(type),at),'Boundary undo must match its exact source custody');
}
const label=event('LABEL_CONFIRMED',{...factoryBefore,condition:'PENDING_LABEL_CONFIRMATION'},{...factoryBefore,version:2,condition:'AVAILABLE'});
check(canUndoMovement(user('Receiving'),piece(),label,null,at),'Legacy unbatched label scan supports own-actor correction');
check(!canUndoMovement(user('Receiving'),piece(),{...label,actor:'Different operator'},null,at),'Legacy events require matching actor');
check(canUndoMovement(user('Supervisor'),piece(),{...label,actor:'Different operator'},null,at),'Supervisor can correct a colleague’s recent workshop scan');
const officeBefore={id:'p1',version:1,journey:'OFFICE',holder:'OFFICE_PENDING'},officeAfter={...officeBefore,version:2,holder:'OFFICE_STOCK'};
const officeLabel=event('OFFICE_LABEL_CONFIRM',officeBefore,officeAfter);
check(canUndoMovement(user('Office Staff'),piece(officeAfter),officeLabel,tx('OFFICE_LABEL_CONFIRM'),at),'Office staff can correct its own office label scan');
check(!canUndoMovement(user('Office Staff'),piece(officeAfter),officeLabel,tx('OFFICE_LABEL_CONFIRM',{created_by:'other'}),at),'Office staff cannot undo another operator’s scan');
for(const role of ['Office Manager','Assistant Manager']){
 for(const [type,from,to] of [['OFFICE_LABEL_CONFIRM','OFFICE_PENDING','OFFICE_STOCK'],['OFFICE_RECEIVE','OFFICE_PENDING','OFFICE_STOCK'],['OFFICE_SALE','OFFICE_STOCK','SOLD']]){
  const movement=event(type,{...officeBefore,holder:from},{...officeAfter,holder:to}),current=piece({...officeAfter,holder:to}),colleague=tx(type,{created_by:'colleague',actor:'Office colleague'});
  check(canUndoMovement(user(role),current,movement,colleague,at),`${role} can correct a colleague’s recent ${type}`);
  check(!canUndoMovement(user('Office Staff'),current,movement,colleague,at),'Office Staff remains restricted to its own office scans');
  check(!canUndoMovement(user(role),{...current,version:3},movement,colleague,at),'Office manager team correction rejects subsequent changes');
  check(!canUndoMovement(user(role),current,{...movement,created_at:minutesAgo(21)},colleague,at),'Office manager team correction expires after20min');
  check(!canUndoMovement(user(role),{...current,holder:'IN_HOUSE'},movement,colleague,at),'Office manager team correction cannot enter workshop custody');
 }
}
check(!canUndoMovement(user('Supervisor'),piece(officeAfter),officeLabel,tx('OFFICE_LABEL_CONFIRM'),at),'Supervisor cannot correct office stock');
check(canUndoMovement(user('Admin'),piece(officeAfter),officeLabel,tx('OFFICE_LABEL_CONFIRM',{created_by:'other'}),at),'Admin can correct recent office scan');
for(const role of ['Office Staff','Assistant Manager','Office Manager']){
 for(const type of ['OFFICE_SEND','OFFICE_DISPUTE_RETURN','CUSTOMER_DISPUTE_RETURN','FACTORY_DISPUTE_RECEIVE','JOBWORK_DISPATCH','JOBWORK_DISPUTE_RETURN'])check(!canUndoMovement(user(role),piece({holder:'OFFICE_PENDING'}),event(type,factoryBefore,{...factoryBefore,version:2,holder:'OFFICE_PENDING'}),tx(type),at),`${role} cannot reverse custody boundary ${type}`);
 check(!canUndoMovement(user(role),piece({holder:'WITH_ARTISAN'}),handoff,tx('HANDOFF'),at),'Office staff cannot correct factory history');
}
check(!canUndoMovement(user('Office Staff'),piece({holder:'IN_HOUSE'}),officeLabel,tx('OFFICE_LABEL_CONFIRM'),at),'Out-of-office current custody blocked');
check(!canUndoMovement(user('Issue'),piece({holder:'WITH_ARTISAN',journey:'OFFICE'}),handoff,tx('HANDOFF'),at),'Office-only journey cannot be corrected through workshop permission');
for(const role of ['Viewer','Unknown role'])check(!canUndoMovement(user(role),piece({holder:'WITH_ARTISAN'}),handoff,tx('HANDOFF'),at),'Read-only and unknown users cannot undo');
console.log(`PASS: ${checks} role-access and scoped-correction assertions. No database writes.`);
