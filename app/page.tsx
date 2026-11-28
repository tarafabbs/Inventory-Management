import {InventoryText} from './inventory-language';
import { redirect } from "next/navigation";
import {productionSnapshot} from '@/lib/production-snapshot';
import type {Snapshot} from '@/lib/production-types';
import ProductionWorkspace from "./production-workspace";
import OfficeOutlet from './office-outlet';
import SignOutButton from "./sign-out-button";
import {inventorySession,officeUser} from "@/lib/inventory-identity";
import {isManagement,isOutletRole} from "@/lib/rules";
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
  const outletStaff=await officeUser(staff);
  const hasOfficeAccess=isOutletRole(outletStaff.role)||isManagement(staff.role);
  const hasWorkshopAccess=!isOutletRole(staff.role);
  const office = isOutletRole(staff.role) || (hasOfficeAccess && params.view === "Office");
  const activeStaff=office?outletStaff:staff;
  const requested=params.action||'';
  const initialAction=Object.hasOwn(actions,requested)&&permitted(activeStaff.role,actions[requested].permission)&&(!office||['office_receive','office_sell','office_return','office_vendor','vendor_return'].includes(requested))?requested:'';
  let initialData:Snapshot|undefined;
  let initialError='';
  try{initialData=await productionSnapshot(activeStaff,{office});}
  catch(error){console.error('Initial stock snapshot failed',error instanceof Error?error.name:'unknown');initialError='Stock could not be loaded. Please retry.';}
  return office?<OfficeOutlet initialStock={initialData} initialError={initialError} workshopAccess={hasWorkshopAccess}/>:<ProductionWorkspace initialData={initialData} initialError={initialError} initialAction={initialAction} officeAccess={hasOfficeAccess}/>;
}
