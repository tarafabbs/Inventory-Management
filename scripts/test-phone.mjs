import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import * as libphone from 'libphonenumber-js/max';

globalThis.__libphone=libphone;
const source=(await readFile(new URL('../lib/phone.ts',import.meta.url),'utf8'))
  .replace("import {getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode} from 'libphonenumber-js/max';",
    'const {getCountries,getCountryCallingCode,parsePhoneNumberFromString}=globalThis.__libphone;');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const phone=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));

assert.equal(phone.countryDialCode('IN'),'+91');
assert.equal(phone.normalizeContactNumber('9876543210'),'+919876543210');
assert.equal(phone.normalizeContactNumber('(202) 555-0123','US'),'+12025550123');
assert.equal(phone.normalizeContactNumber('', 'IN'), '');
assert.throws(()=>phone.normalizeContactNumber('987654321','IN',true),/selected country/);
assert.throws(()=>phone.normalizeContactNumber('+12025550123','IN',true),/selected country/);
assert.throws(()=>phone.normalizeContactNumber('', 'IN',true),/required/);
assert.deepEqual(phone.phoneParts('+12025550123'),{country:'US',national:'2025550123'});
assert.deepEqual(phone.phoneParts('9876543210'),{country:'IN',national:'9876543210'});
console.log('PASS: India default, country-specific validation, E.164 storage and legacy edit');
