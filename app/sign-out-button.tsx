"use client";
import {useInventoryLanguage} from '@/app/inventory-language';

import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function SignOutButton({ className = "btn" }: { className?: string }) {
    const {t:tr}=useInventoryLanguage();

  return (
    <button type="button" className={className} aria-label={tr("Sign out")} onClick={async () => {
      await createClient().auth.signOut();
      window.location.assign("/sign-in");
    }}>
      <LogOut size={15} />  {tr("Sign out")}
    </button>
  );
}

