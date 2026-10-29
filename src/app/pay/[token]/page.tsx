import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { WalletProviders } from "@/components/WalletProviders";
import { findRequestByToken } from "@/lib/payments/requests";
import { listAttempts, type AttemptView } from "@/lib/payments/verification";
import { createAdminClient } from "@/lib/supabase/server";

import { PayWithWallet } from "./PayWithWallet";

export const metadata: Metadata = {
  title: "Payment request — StableFlow",
  robots: { index: false, follow: false },
};

export default function PayPage({ params }: PageProps<"/pay/[token]">) {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-12">
      <Suspense fallback={<p>Loading payment request…</p>}>
        <PaymentDetails params={params} />
      </Suspense>
    </main>
  );
}

async function PaymentDetails({ params }: { params: PageProps<"/pay/[token]">["params"] }) {
  await connection();
  const { token } = await params;

  const admin = createAdminClient();
  let request;
  let attempts: AttemptView[] = [];
  try {
    const capability = await findRequestByToken(admin, token, new Date());
    request = capability?.projection ?? null;
    if (capability) attempts = await listAttempts(admin, capability.id);
  } catch {
    return (
      <p role="alert">This payment request can’t be loaded right now. Refresh to try again.</p>
    );
  }

  if (!request) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Payment link not available</h1>
        <p>
          This payment link is invalid, expired or cancelled. Ask the person who sent it for a new
          link. Do not send funds to an address from an inactive link.
        </p>
      </>
    );
  }

  // Resume from server state: a verified attempt, else the latest unfinished one.
  const resume =
    attempts.find((attempt) => attempt.status === "verified") ??
    attempts.find((attempt) => attempt.status === "submitted" || attempt.status === "pending") ??
    null;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Payment request</h1>
      <p className="text-4xl font-semibold">
        {request.amountDisplay} <span className="text-2xl">test {request.tokenSymbol}</span>
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="font-medium">Network</dt>
        <dd>
          {request.chainName} (chain ID {request.chainId}) — testnet only
        </dd>
        <dt className="font-medium">Token</dt>
        <dd>
          Test {request.tokenSymbol} — <strong>no financial value</strong>
          <span className="block break-all font-mono text-xs opacity-80">{request.tokenAddress}</span>
        </dd>
        <dt className="font-medium">Send to</dt>
        <dd className="break-all font-mono text-xs">{request.recipient}</dd>
        <dt className="font-medium">Expires</dt>
        <dd>{new Date(request.expiresAt).toUTCString()}</dd>
      </dl>
      <p className="rounded-md border border-current/20 p-3 text-sm">
        Send exactly this amount, on this network, in one transfer. Sending on another network,
        a different token, or a different amount will not be matched to this request.
      </p>
      <WalletProviders>
        <PayWithWallet token={token} request={request} initialAttempt={resume} />
      </WalletProviders>
    </>
  );
}
