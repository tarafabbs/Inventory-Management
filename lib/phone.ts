import {getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode} from 'libphonenumber-js/max';

const countries=new Set<string>(getCountries());

export function countryDialCode(country:string){
  return countries.has(country)?`+${getCountryCallingCode(country as CountryCode)}`:'';
}

export function normalizeContactNumber(value:unknown,country:unknown='IN',required=false,label='Contact number'){
  const raw=String(value??'').trim();
  if(!raw){if(required)throw Error(`${label} is required.`);return '';}
  const selected=String(country||'IN').toUpperCase();
  if(!countries.has(selected))throw Error(`Choose a country for ${label.toLowerCase()}.`);
  if(!/^[+\d\s().-]+$/.test(raw))throw Error(`Enter a valid ${label.toLowerCase()}.`);
  const parsed=parsePhoneNumberFromString(raw,selected as CountryCode);
  if(!parsed?.isValid()||parsed.country!==selected||selected==='IN'&&parsed.nationalNumber.length!==10)
    throw Error(`Enter a valid ${label.toLowerCase()} for the selected country${selected==='IN'?' (10 digits)':''}.`);
  return parsed.number;
}

export function phoneParts(value:string){
  const parsed=value?.startsWith('+')?parsePhoneNumberFromString(value):undefined;
  return {country:parsed?.country||'IN',national:parsed?.nationalNumber||value||''};
}

export const phoneCountries=getCountries();
