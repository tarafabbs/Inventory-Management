"use client";

import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function SignOutButton({ className = "btn" }: { className?: string }) {
  return (
    <button type="button" className={className} aria-label="Sign out" onClick={async () => {
      await createClient().auth.signOut();
      window.location.assign("/sign-in");
    }}>
      <LogOut size={15} /> Sign out
    </button>
  );
}

