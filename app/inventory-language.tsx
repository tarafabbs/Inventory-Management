'use client';
import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import {translateInventory,type InventoryLanguage} from '@/lib/inventory-translations';

type LanguageContextValue={language:InventoryLanguage;t:(value:string|null|undefined)=>string};
const LanguageContext=createContext<LanguageContextValue>({language:'en',t:value=>value||''});
export function useInventoryLanguage(){return useContext(LanguageContext);}
export function InventoryText({value}:{value:string}){const {t}=useInventoryLanguage();return <>{t(value)}</>;}
export default function InventoryLanguageProvider({children,initialLanguage='en'}:{children:ReactNode;initialLanguage?:InventoryLanguage}){
 const [language,setLanguage]=useState<InventoryLanguage>(initialLanguage);
 const t=useCallback((value:string|null|undefined)=>translateInventory(value||'',language),[language]);
 const context=useMemo(()=>({language,t}),[language,t]);
 useEffect(()=>{document.documentElement.lang=language;document.body.dataset.language=language;},[language]);
 function choose(next:InventoryLanguage){
  setLanguage(next);
  // Cookie supplies the same language on the next server-rendered page. No reload,
  // remount, DOM text mutation or changes to draft / ledger values are needed.
  try{document.cookie=`ims-language=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol==='https:'?'; Secure':''}`;}catch{/* Restricted cookies must not break the toggle. */}
  try{localStorage.setItem('ims-language',next);}catch{/* Language still works when browser storage is disabled. */}
 }
 return <LanguageContext.Provider value={context}><div className="inventory-language-bar" aria-label={t('Choose language')}>
  <span>{language==='bn'?'অ্যাপের ভাষা':'App language'}</span><div role="group" aria-label="English / বাংলা">
   <button type="button" lang="en" aria-pressed={language==='en'} onClick={()=>choose('en')}>English</button>
   <button type="button" lang="bn" aria-pressed={language==='bn'} onClick={()=>choose('bn')}>বাংলা</button>
  </div></div>{children}</LanguageContext.Provider>;
}
