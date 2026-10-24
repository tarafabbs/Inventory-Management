"use client";

import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export default function SignOutButton() {
  return (
    <button className="btn" onClick={async () => { await authClient.signOut(); window.location.assign("/sign-in"); }}>
      <LogOut size={15} /> Sign out
    </button>
  );
}

