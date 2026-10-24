import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SignInButton from "./sign-in-button";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/");
  return (
    <main className="loading-page">
      <div className="brand-logo">TM</div>
      <h1>IMS TARA MAA</h1>
      <p>Sign in to open your private inventory workspace.</p>
      <SignInButton />
    </main>
  );
}

