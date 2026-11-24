import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Workspace from "./workspace";
import QuantityWorkspace from "./quantity-workspace";
import {inventoryUser} from "@/lib/inventory-identity";
import {isOfficeRole} from "@/lib/rules";

export const dynamic = "force-dynamic";

export default async function Page({searchParams}: {searchParams: Promise<{view?:string}>}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) redirect("/sign-in");

  const staff = await inventoryUser(user);
  const officeOnly = !!staff?.active && (isOfficeRole(staff.role) || (staff.role === "Admin" && (await searchParams).view === "Office"));
  if (!officeOnly) return <QuantityWorkspace/>;

  return <div className="qty-office-bridge">
    <Workspace identity={{name: staff.name, email: staff.email}}/>
  </div>;
}
