import { redirect } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import SignInButton from "./sign-in-button";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/");
  return (
    <main className="loading-page">
      <Image
        className="signin-brand-lockup"
        src="/ims-tara-maa-logo-purple-white.png"
        alt="IMS TARA MAA by TARAFABBS"
        width={760}
        height={254}
        priority
      />
      <p>Sign in to open your private inventory workspace.</p>
      <SignInButton />
    </main>
  );
}

