import { redirect } from "next/navigation";
import ProductionWorkspace from "./production-workspace";
import SignOutButton from "./sign-out-button";
import {inventorySession} from "@/lib/inventory-identity";
import {isManagement,isOfficeRole} from "@/lib/rules";

export const dynamic = "force-dynamic";

export default async function Page({searchParams}: {searchParams: Promise<{view?:string}>}) {
  const {signedIn,staff} = await inventorySession();
  if (!signedIn) redirect("/sign-in");
  if (!staff) return <main className="loading-page">
    <h1>Staff access required</h1>
    <p>Sign in with the Google email approved by your Owner.</p>
    <SignOutButton/>
  </main>;

  const office = isOfficeRole(staff.role) || (isManagement(staff.role) && (await searchParams).view === "Office");
  return <ProductionWorkspace office={office}/>;
}
