import type { Metadata } from "next";

import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Sign in — StableFlow" };

export default function SignInPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in to StableFlow</h1>
      <p className="text-sm">
        This is a testnet demo. Use a test email account — do not enter banking details or
        personal financial information anywhere in this app.
      </p>
      <SignInForm />
    </main>
  );
}
