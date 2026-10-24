import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Workspace from "./workspace";

export const dynamic = "force-dynamic";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) redirect("/sign-in");

  return (
    <Workspace
      identity={{
        name: user.user_metadata.full_name || user.user_metadata.name || user.email,
        email: user.email,
      }}
    />
  );
}
