// Regression: show a complete dashboard on the first render and use one stock query.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import React from 'react';
import {renderToString} from 'react-dom/server';
const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const module=async source=>import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText).toString('base64'));
const user={id:'test-owner',name:'Test Owner',role:'Admin'};
const row={balances:[],history:[],companies:[{id:'company',name:'Example Company',active:1}],products:[],artisans:[],money:[],documents:[],openingDate:''};
const calls=[];
globalThis.loadingDb={prepare(sql){const call={sql};calls.push(call);return {bind(...args){call.args=args;return this;},async first(timeout){call.timeout=timeout;return structuredClone(row);}};}};
const snapshotSource=await read('../lib/production-snapshot.ts');
const {productionSnapshot}=await module(snapshotSource.replace(/import \{\s*db\s*\} from '\.\/database';/,'const db=globalThis.loadingDb;'));
const initialData=await productionSnapshot(user);
assert.equal(calls.length,1,'Snapshot must use exactly one query, not parallel unnamed statements');
assert.equal(calls[0].timeout,12000,'Server reads must have a deadline');
assert.equal(calls[0].args.length,4);assert.equal(initialData.companies.length,1);
await productionSnapshot(user,{office:true});assert.ok(!calls[1].sql.includes('FROM artisans'),'Office snapshots exclude artisan profiles');assert.ok(calls[1].sql.includes("'[]'::jsonb AS money"),'Office snapshots exclude financial due');
const production=await module(await read('../lib/production.ts'));const rules=await module(await read('../lib/rules.ts'));globalThis.loadingProduction=production;globalThis.loadingRules=rules;
let ui=await read('../app/production-workspace.tsx');
ui=ui.replace(/import \{useInventoryLanguage\} from '@\/app\/inventory-language';/,"const useInventoryLanguage=()=>({t:value=>value||''});");
ui=ui.replace(/from 'react'/g,'from '+JSON.stringify(import.meta.resolve('react'))).replace(/import \{[^;]+\} from '@\/lib\/production';/,'const {actions,labels,stages,accountKey}=globalThis.loadingProduction;').replace(/import \{[^;]+\} from '@\/lib\/rules';/,'const {artisanWorkTypes,isManagement,isOfficeRole,isOwner,permitted}=globalThis.loadingRules;').replace(/import SignOutButton from '\.\/sign-out-button';/,'const SignOutButton=()=>null;').replace(/import StaffManagement from '\.\/staff-management';/,'const StaffManagement=()=>null;').replace(/import '\.\/production.css';/,'');
let compiled=ts.transpileModule(ui,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;compiled=compiled.replace(/from "react\/jsx-runtime"/g,'from '+JSON.stringify(import.meta.resolve('react/jsx-runtime')));
const {default:Workspace}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const html=renderToString(React.createElement(Workspace,{initialData}));
assert.ok(html.includes('Total in our custody'),'First render contains stock dashboard');assert.ok(html.includes('Company Return'),'First render contains working navigation');assert.ok(html.includes('Opening Balance'));assert.ok(!html.includes('Loading your stock'),'An authenticated first render must not be a client-only loading screen');
const failed=renderToString(React.createElement(Workspace,{initialError:'Connection unavailable'}));assert.ok(failed.includes('Connection unavailable'));assert.ok(failed.includes('Reload'));
console.log('PASS: single-query stock snapshot, Office scope, initial dashboard rendering and retry fallback.');
if(process.argv.includes('--database')){
 const databaseSource=(await read('../lib/database.ts')).replace('from "postgres"','from '+JSON.stringify(import.meta.resolve('postgres')));
 globalThis.realLoadingDb=(await module(databaseSource)).db;
 const actual=await module(snapshotSource.replace(/import \{\s*db\s*\} from '\.\/database';/,'const db=globalThis.realLoadingDb;'));
 const at=Date.now();const data=await actual.productionSnapshot(user);assert.ok(Array.isArray(data.companies));console.log('PASS: actual PostgreSQL adapter snapshot in '+(Date.now()-at)+'ms.');
 await assert.rejects(realLoadingDb.prepare('SELECT pg_sleep(2)').first(100),/timed out/);
 console.log('PASS: slow-read cancellation deadline. No database writes.');process.exit(0);
}
