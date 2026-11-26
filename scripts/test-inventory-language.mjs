import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
async function load(source){let code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;for(const name of ['react','react/jsx-runtime'])code=code.replace(new RegExp('from [\\\'"]'+name.replaceAll('/','\\/')+'[\\\'"]','g'),'from '+JSON.stringify(import.meta.resolve(name)));return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));}
const dictionary=await load(await read('lib/inventory-translations.ts'));globalThis.testInventoryDictionary=dictionary;
const language=await load((await read('app/inventory-language.tsx')).replace(/import \{[^;]+\} from '@\/lib\/inventory-translations';/,'const {translateInventory}=globalThis.testInventoryDictionary;'));
globalThis.testInventoryLanguage=language;
globalThis.testInventoryProduction=await load(await read('lib/production.ts'));
globalThis.testInventoryRules=await load(await read('lib/rules.ts'));
const uiSource=await read('app/production-workspace.tsx');
const source=uiSource.replace(/import \{useInventoryLanguage\} from '@\/app\/inventory-language';/,'const {useInventoryLanguage}=globalThis.testInventoryLanguage;').replace(/import \{[^;]+\} from '@\/lib\/production';/,'const {actions,labels,stages,accountKey}=globalThis.testInventoryProduction;').replace(/import \{[^;]+\} from '@\/lib\/rules';/,'const {artisanWorkTypes,isManagement,isOfficeRole,isOwner,permitted}=globalThis.testInventoryRules;').replace(/import SignOutButton from '\.\/sign-out-button';/,'const SignOutButton=()=>null;').replace(/import StatementPanel from '\.\/statement-panel';/,'const StatementPanel=()=>null;').replace(/import ArtisanReceive from '\.\/artisan-receive';/,'const ArtisanReceive=()=>null;').replace(/import StaffManagement from '\.\/staff-management';/,'const StaffManagement=()=>null;').replace(/import '\.\/production.css';/,'');
const {default:Workspace}=await load(source);
const fixture={user:{id:'owner',name:'Test Owner',role:'Admin'},companies:[{id:'A',name:'Home',active:1}],products:[{id:'silk',name:'Silk — R+S',active:1}],artisans:[{id:'X',name:'Office Manager',active:1}],balances:[{company:'A',product:'silk',pool:'normal',stage:'artist',artisan:'X',arts:'R',work:'S',quantity:15}],money:[],documents:[],history:[],openingDate:''};
const render=lang=>renderToStaticMarkup(React.createElement(language.default,{initialLanguage:lang},React.createElement(Workspace,{initialData:fixture})));
const en=render('en'),bn=render('bn');
assert.ok(en.includes('Total in our custody'));assert.ok(bn.includes('আমাদের দায়িত্বে মোট মাল'));assert.ok(bn.includes('কারিগরকে মাল দিন'));assert.ok(bn.includes('শুরুর হিসেব'));assert.ok(bn.includes('Silk — R+S'));assert.ok(bn.includes('Office Manager'),'Artist name must not be translated as a role');assert.ok(bn.includes('Home')&&!bn.includes('⌂ Home'),'Company name must not be translated as a navigation label');
assert.ok(bn.indexOf('inventory-language-bar')<bn.indexOf('IMS TARA MAA'),'Toggle appears above the app header');assert.ok(bn.includes('lang="bn" aria-pressed="true"'));assert.ok(en.includes('lang="en" aria-pressed="true"'));
assert.ok(!bn.includes('Loading your stock'));assert.ok(en.includes('Total in our custody'),'Switching back uses original English labels');
for(const value of ['Available stock changed or the quantity exceeds this balance. Reload and review.','Quantity exceeds remaining stock.','Stock loading timed out. Please retry.','Enter a valid 10-character PAN or leave it blank.'])assert.notEqual(dictionary.translateInventory(value,'bn'),value);
for(const [kind,a] of Object.entries(testInventoryProduction.actions))assert.notEqual(dictionary.translateInventory(a.label,'bn'),a.label,'Missing action '+kind);
for(const [stage,label]of Object.entries(testInventoryProduction.labels))assert.notEqual(dictionary.translateInventory(label,'bn'),label,'Missing stock stage '+stage);
// Translation must never change ledger keys, option values, routes or controlled input bindings.
const sensitive=new Set(['key','name','value','defaultValue','type','href','aria-current']);
const collect=(file,text)=>{const result=[],a=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);function walk(n){if(ts.isJsxAttribute(n)&&sensitive.has(n.name.getText(a)))result.push(n.getText(a));ts.forEachChild(n,walk);}walk(a);return result;};
for(const file of ['app/production-workspace.tsx','app/quantity-workspace.tsx','app/staff-management.tsx','app/sign-out-button.tsx','app/sign-in/sign-in-button.tsx']){const before=execFileSync('git',['show','HEAD:'+file],{encoding:'utf8'});const current=collect(file,await read(file));let cursor=0;for(const control of collect(file,before)){// A source-specific entry key intentionally isolates dispute-action drafts.
const expected=file==='app/production-workspace.tsx'&&control==='key={kind + company}'?"key={kind + company+(entrySource?accountKey(entrySource):'')}":control;const at=current.indexOf(expected,cursor);assert.ok(at>=0,'Existing control changed in '+file+': '+control);cursor=at+1;}assert.ok(collect(file,await read(file)).every(value=>! /\btr\(/.test(value)),'A translated control value was found in '+file);}
const provider=await read('app/inventory-language.tsx');assert.ok(!/MutationObserver|TreeWalker|\.nodeValue/.test(provider));assert.ok(provider.includes('document.cookie'));assert.ok(provider.includes('localStorage'));assert.ok(!/location\.(reload|assign)|key=\{language\}/.test(provider),'Language changes must not reload or remount the form');
console.log('PASS: bilingual first render, top toggle, unchanged business names, all actions/stages, translated errors, persistent preference and unchanged controlled values.');
