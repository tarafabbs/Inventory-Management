"use client";

import { createClient } from "@/lib/supabase/client";

export default function SignInButton() {
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
      Continue with Google
    </button>
  );
}

