import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { findPublicRequest } from "@/lib/payments/requests";
import { createAdminClient } from "@/lib/supabase/server";

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

  let request;
  try {
    request = await findPublicRequest(createAdminClient(), token, new Date());
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
      <p className="text-sm opacity-80">
        In-app payment with a connected wallet is coming in the next version of this demo.
      </p>
    </>
  );
}
