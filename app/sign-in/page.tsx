import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import SignInButton from "./sign-in-button";

export default async function SignInPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect("/");
  return (
    <main className="loading-page">
      <div className="brand-logo">TM</div>
      <h1>IMS TARA MAA</h1>
      <p>Sign in to open your private inventory workspace.</p>
      <SignInButton />
    </main>
  );
}

