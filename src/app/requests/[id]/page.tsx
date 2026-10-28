import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { BASE_SEPOLIA, TEST_USDC } from "@/lib/chain/allowlist";
import { formatUsdcUnits } from "@/lib/payments/amount";
import { STATUS_LABELS } from "@/lib/payments/labels";
import { effectiveStatus, type RequestStatus } from "@/lib/payments/requests";
import { requestIdSchema } from "@/lib/payments/server";
import { createUserClient, getCurrentUser } from "@/lib/supabase/server";

import { RequestActions } from "./RequestActions";

export const metadata: Metadata = { title: "Payment request — StableFlow" };

export default function RequestPage({ params }: PageProps<"/requests/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-12">
      <Link href="/requests" className="text-sm underline">
        ← All requests
      </Link>
      <Suspense fallback={<p>Loading request…</p>}>
        <RequestDetails params={params} />
      </Suspense>
    </main>
  );
}

async function RequestDetails({ params }: { params: PageProps<"/requests/[id]">["params"] }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const id = requestIdSchema.safeParse((await params).id);
  if (!id.success) notFound();

  // RLS: another user's request is indistinguishable from a missing one.
  const supabase = await createUserClient();
  const { data: request } = await supabase
    .from("payment_requests")
    .select("id, amount_units::text, recipient_snapshot, status, created_at, expires_at")
    .eq("id", id.data)
    .maybeSingle<{
      id: string;
      amount_units: string;
      recipient_snapshot: string;
      status: RequestStatus;
      created_at: string;
      expires_at: string;
    }>();
  if (!request) notFound();

  const status = effectiveStatus(request, new Date());

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        {formatUsdcUnits(request.amount_units)} test USDC
      </h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="font-medium">Status</dt>
        <dd>{STATUS_LABELS[status]}</dd>
        <dt className="font-medium">Network</dt>
        <dd>{BASE_SEPOLIA.name} (testnet)</dd>
        <dt className="font-medium">Token</dt>
        <dd>
          Test {TEST_USDC.symbol}, no financial value
        </dd>
        <dt className="font-medium">Recipient</dt>
        <dd className="break-all font-mono text-xs">{request.recipient_snapshot}</dd>
        <dt className="font-medium">Created</dt>
        <dd>{new Date(request.created_at).toUTCString()}</dd>
        <dt className="font-medium">Expires</dt>
        <dd>{new Date(request.expires_at).toUTCString()}</dd>
      </dl>
      <p className="text-xs opacity-80">
        The amount, recipient, token and network are fixed once the request is created.
      </p>
      {status === "open" && <RequestActions requestId={request.id} />}
    </>
  );
}
