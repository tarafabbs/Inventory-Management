'use client';
import {useState} from 'react';
import {countryDialCode,normalizeContactNumber,phoneCountries,phoneParts} from '@/lib/phone';

const names=new Intl.DisplayNames(['en'],{type:'region'});
const options=phoneCountries.map(code=>({code,name:names.of(code)||code,dial:countryDialCode(code)}))
  .sort((a,b)=>a.name.localeCompare(b.name));

export default function PhoneField({name='phone',label='Contact number',defaultValue='',required=false,disabled=false}:{name?:string;label?:string;defaultValue?:string;required?:boolean;disabled?:boolean}){
  const initial=phoneParts(defaultValue),[country,setCountry]=useState<string>(initial.country),[number,setNumber]=useState(initial.national);
  const [error,setError]=useState('');
  function check(value=number,code=country){
    try{normalizeContactNumber(value,code,required,label);setError('');return true;}
    catch(e){setError((e as Error).message);return false;}
  }
  return <div className="phone-field">
    <label>{label} {required?'':'(optional)'}
      <span className="phone-field-controls">
        <select name={`${name}Country`} aria-label={`${label} country code`} value={country} disabled={disabled} onChange={e=>{setCountry(e.target.value);if(number)check(number,e.target.value);}}>
          {options.map(option=><option key={option.code} value={option.code}>{option.name} ({option.dial})</option>)}
        </select>
        <input name={name} type="tel" inputMode="tel" autoComplete="tel-national" aria-label={`${label} national number`} value={number} required={required&&!disabled} disabled={disabled} onChange={e=>{setNumber(e.target.value);if(error)check(e.target.value);}} onBlur={()=>{if(!disabled)check();}} aria-invalid={!!error} aria-describedby={error?`${name}-error`:undefined}/>
      </span>
    </label>
    {error&&<small id={`${name}-error`} role="alert" className="prod-error">{error}</small>}
  </div>;
}
