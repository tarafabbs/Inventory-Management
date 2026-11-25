import {InventoryText} from './inventory-language';
import { redirect } from "next/navigation";
import {productionSnapshot} from '@/lib/production-snapshot';
import type {Snapshot} from '@/lib/production-types';
import ProductionWorkspace from "./production-workspace";
import SignOutButton from "./sign-out-button";
import {inventorySession} from "@/lib/inventory-identity";
import {isManagement,isOfficeRole} from "@/lib/rules";
import {permitted} from "@/lib/rules";
import {actions} from '@/lib/production';

export const dynamic = "force-dynamic";

export default async function Page({searchParams}: {searchParams: Promise<{view?:string;action?:string}>}) {
  const {signedIn,staff} = await inventorySession();
  if (!signedIn) redirect("/sign-in");
  if (!staff) return <main className="loading-page">
    <h1><InventoryText value="Staff access required"/></h1>
    <p><InventoryText value="Sign in with the Google email approved by your Owner."/></p>
    <SignOutButton/>
  </main>;

  const params=await searchParams;
  const office = isOfficeRole(staff.role) || (isManagement(staff.role) && params.view === "Office");
  const requested=params.action||'';
  const initialAction=Object.hasOwn(actions,requested)&&permitted(staff.role,actions[requested].permission)&&(!office||['office_receive','office_sell','office_return','office_vendor','vendor_return'].includes(requested))?requested:'';
  let initialData:Snapshot|undefined;
  let initialError='';
  try{initialData=await productionSnapshot(staff,{office});}
  catch(error){console.error('Initial stock snapshot failed',error instanceof Error?error.name:'unknown');initialError='Stock could not be loaded. Please retry.';}
  return <ProductionWorkspace office={office} initialData={initialData} initialError={initialError} initialAction={initialAction}/>;
}
