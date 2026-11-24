"use client";
import {useInventoryLanguage} from '@/app/inventory-language';

import { createClient } from "@/lib/supabase/client";

export default function SignInButton() {
    const {t:tr}=useInventoryLanguage();

  async function signIn() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { prompt: "select_account" },
      },
    });
  }

  return (
    <button className="btn primary" onClick={signIn}>

      {tr("Continue with Google")}
    </button>
  );
}

