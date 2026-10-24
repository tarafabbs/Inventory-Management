"use client";

import { authClient } from "@/lib/auth-client";

export default function SignInButton() {
  return (
    <button className="btn primary" onClick={() => authClient.signIn.social({ provider: "google", callbackURL: "/" })}>
      Continue with Google
    </button>
  );
}

