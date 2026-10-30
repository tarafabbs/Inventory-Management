// Pure company/Thanwala account checks: no database connection or persistent writes.
// Run: node scripts/test-source-ledgers.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source=await readFile(new URL('../lib/source-ledger.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {buildSourceLedgers}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const line=(id,patch={})=>({id,code:id,company_id:'company-jobwork',product_id:'product-silk',lot_id:'lot-jobwork',ownership:'EXTERNAL',holder:'IN_HOUSE',condition:'AVAILABLE',...patch});
const transaction=(id,type,rows,patch={})=>({id,number:id,type,status:'CONFIRMED',snapshot:JSON.stringify(rows),actor:'Tester',created_at:'2026-10-30T10:00:00.000Z',...patch});

const data={
 companies:[
  {id:'company-jobwork',name:'Example Jobwork Ltd',ownership:'EXTERNAL',prefix:'EJL',active:1},
  {id:'company-own',name:'IMS TARA MAA',ownership:'OWN',prefix:'IMS',active:1}
 ],
 thanwalas:[{id:'thanwala-one',name:'Example Thanwala',contact:'9000000000',active:1}],
 products:[{id:'product-silk',name:'Silk Saree'},{id:'product-cotton',name:'Cotton Saree'}],
 artisans:[{id:'artisan-one',name:'Example Artisan'}],
 lots:[
  {id:'lot-jobwork',company_id:'company-jobwork',product_id:'product-silk',accepted:10,status:'CONFIRMED'},
  {id:'lot-draft',company_id:'company-jobwork',product_id:'product-silk',accepted:99,status:'DRAFT'},
  {id:'lot-own',company_id:'company-own',thanwala_id:'thanwala-one',product_id:'product-cotton',accepted:7,status:'CONFIRMED'}
 ],
 generatedLabels:[line('EJL-000004',{state:'PENDING',holder:null,condition:'PENDING_LABEL_CONFIRMATION'})],
 pieces:[
  line('EJL-000001',{holder:'WITH_ARTISAN',condition:'WITH_ARTISAN',artisan_id:'artisan-one'}),
  line('EJL-000002',{holder:'JOBWORK_COMPANY',condition:'FINISHED'}),
  line('EJL-000003',{condition:'DISPUTED'}),
  line('IMS-000001',{company_id:'company-own',thanwala_id:'thanwala-one',product_id:'product-cotton',lot_id:'lot-own'}),
  line('IMS-000002',{company_id:'company-own',thanwala_id:'thanwala-one',product_id:'product-cotton',lot_id:'lot-own',holder:'RETURNED_TO_SOURCE',condition:'DAMAGED'})
 ],
 transactions:[
  transaction('TX-DESPATCH','JOBWORK_DISPATCH',[line('EJL-000002',{holder:'JOBWORK_COMPANY',condition:'FINISHED'})]),
  transaction('TX-DISPUTE','JOBWORK_DISPUTE_RETURN',[line('EJL-000003',{condition:'DISPUTED'})]),
  transaction('TX-THANWALA-RETURN','SUPPLIER_RETURN',[line('IMS-000002',{company_id:'company-own',thanwala_id:'thanwala-one',product_id:'product-cotton',holder:'RETURNED_TO_SOURCE'})]),
  transaction('TX-OFFICE','OFFICE_SEND',[line('IMS-000001',{company_id:'company-own',thanwala_id:'thanwala-one',product_id:'product-cotton'})]),
  transaction('TX-VOID','JOBWORK_DISPATCH',[line('EJL-000002',{holder:'JOBWORK_COMPANY'})],{status:'VOIDED_BY_REVERSAL'})
 ]
};

const ledgers=buildSourceLedgers(data),company=ledgers.companies[0],thanwala=ledgers.thanwalas[0];
assert.equal(ledgers.companies.length,1,'Only external jobwork companies receive a company khata.');
assert.equal(ledgers.thanwalas.length,1,'Every Thanwala receives an own-stock khata.');
assert.equal(company.received,10,'Accepted jobwork receipts are the lifetime received total.');
assert.equal(company.current,3,'Despatched jobwork and returned source stock are outside the current company balance.');
assert.equal(company.stockCheckExpected,2,'Pending labels are excluded from a frozen stock-check count.');
assert.equal(company.withArtisan,1,'Current artisan custody is counted.');
assert.equal(company.disputedNow,1,'Current disputes are highlighted.');
assert.equal(company.pendingLabels,1,'Unscanned labels remain visible in the company khata.');
assert.equal(company.freshDespatched,1,'Only confirmed finished despatches are counted.');
assert.equal(company.disputeReceived,1,'Confirmed company dispute returns are counted separately.');
assert.equal(company.artisanGroups[0].artisan,'Example Artisan','Artisan pending groups resolve the worker name.');
assert.deepEqual(company.artisanGroups[0].codes,['EJL-000001'],'Artisan pending groups retain exact barcode codes.');
assert.equal(company.categories[0].received,10,'Product-category receipts reconcile to the lot.');
assert.equal(thanwala.received,7,'Thanwala purchased quantity comes from own-stock lots.');
assert.equal(thanwala.current,1,'Returned source stock is excluded from the live Thanwala balance.');
assert.equal(thanwala.stockCheckExpected,1,'Live Thanwala stock is stock-check eligible.');
assert.equal(thanwala.returnedToSource,1,'Thanwala returns are counted separately.');
assert.equal(thanwala.sentToOffice,1,'Office dispatches remain visible in the Thanwala lifetime account.');
assert.ok(company.movements.every(row=>row.id!=='TX-VOID'||row.status!=='CONFIRMED'),'Reversed movements do not inflate confirmed totals.');
console.log('PASS: 20 company/Thanwala lifetime-khata assertions. No database writes.');
