import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LinkWallet } from "@/components/LinkWallet";
import { WalletProviders } from "@/components/WalletProviders";
import { BASE_SEPOLIA } from "@/lib/chain/allowlist";
import { createUserClient, getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Account — StableFlow" };

export default function AccountPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Your account</h1>
      <Suspense fallback={<p>Loading your account…</p>}>
        <AccountDetails />
      </Suspense>
    </main>
  );
}

async function AccountDetails() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  // User-scoped client: RLS limits results to this user's wallets.
  const supabase = await createUserClient();
  const { data: wallets, error } = await supabase
    .from("wallets")
    .select("id, address, chain_id, verified_at")
    .order("verified_at", { ascending: false });

  return (
    <>
      <section className="flex flex-col gap-2">
        <p className="text-sm">
          Signed in as <strong>{user.email}</strong>
        </p>
        <form action="/auth/sign-out" method="post">
          <button type="submit" className="text-sm underline">
            Sign out
          </button>
        </form>
      </section>

      <section aria-labelledby="wallets-heading" className="flex flex-col gap-4">
        <h2 id="wallets-heading" className="text-lg font-semibold">
          Test wallets ({BASE_SEPOLIA.name})
        </h2>
        {error ? (
          <p role="alert" className="text-sm">
            Could not load your wallets. Refresh to try again.
          </p>
        ) : wallets && wallets.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {wallets.map((wallet) => (
              <li key={wallet.id} className="break-all font-mono text-sm">
                {wallet.address}{" "}
                <span className="font-sans opacity-70">
                  — verified {new Date(wallet.verified_at).toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">No wallet linked yet.</p>
        )}
        <WalletProviders>
          <LinkWallet />
        </WalletProviders>
      </section>
    </>
  );
}
