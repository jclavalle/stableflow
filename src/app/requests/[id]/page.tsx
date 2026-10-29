import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { BASE_SEPOLIA, TEST_USDC } from "@/lib/chain/allowlist";
import { formatUsdcUnits } from "@/lib/payments/amount";
import { rejectionMessage, STATUS_LABELS } from "@/lib/payments/labels";
import { effectiveStatus, type RequestStatus } from "@/lib/payments/requests";
import { requestIdSchema } from "@/lib/payments/server";
import {
  QUOTE_COLUMNS,
  SIMULATION_COLUMNS,
  toQuoteView,
  toSimulationView,
  type QuoteRow,
  type SimulationRow,
} from "@/lib/payouts/views";
import { createUserClient, getCurrentUser } from "@/lib/supabase/server";

import { CheckPayment } from "./CheckPayment";
import { History, type HistoryEvent } from "./History";
import { PayoutPanel } from "./PayoutPanel";
import { RequestActions } from "./RequestActions";

type Receipt = {
  tx_hash: string;
  block_number: string;
  block_timestamp: string;
  sender: string;
  confirmations: number;
  verified_at: string;
};

type Attempt = { tx_hash: string; status: string; error_code: string | null; confirmations: number; created_at: string };

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

  const [{ data: receipt }, { data: attempts }, { data: quotes }, { data: simulation }, { data: events }] = await Promise.all([
    supabase
      .from("verified_receipts")
      .select("tx_hash, block_number::text, block_timestamp, sender, confirmations, verified_at")
      .eq("request_id", request.id)
      .maybeSingle<Receipt>(),
    supabase
      .from("payment_attempts")
      .select("tx_hash, status, error_code, confirmations, created_at")
      .eq("request_id", request.id)
      .order("created_at", { ascending: false })
      .returns<Attempt[]>(),
    supabase
      .from("payout_quotes")
      .select(QUOTE_COLUMNS)
      .eq("request_id", request.id)
      .order("created_at", { ascending: false })
      .returns<QuoteRow[]>(),
    supabase.from("payout_simulations").select(SIMULATION_COLUMNS).eq("request_id", request.id).maybeSingle<SimulationRow>(),
    supabase
      .from("audit_events")
      .select("id, event_type, metadata, created_at")
      .eq("request_id", request.id)
      .order("created_at", { ascending: true })
      .returns<HistoryEvent[]>(),
  ]);
  const quoteViews = (quotes ?? []).map(toQuoteView);
  const simulationView = simulation ? toSimulationView(simulation) : null;
  const simulationQuote = simulationView ? (quoteViews.find((q) => q.id === simulationView.quoteId) ?? null) : null;
  const hasUnfinished = (attempts ?? []).some((a) => a.status === "submitted" || a.status === "pending");

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

      {receipt && (
        <section aria-labelledby="receipt-heading" className="flex flex-col gap-2 rounded-md border border-current/20 p-4">
          <h2 id="receipt-heading" className="text-lg font-semibold">
            Verified receipt (blockchain evidence)
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="font-medium">Transaction</dt>
            <dd className="break-all">
              <a href={`${BASE_SEPOLIA.explorerUrl}/tx/${receipt.tx_hash}`} target="_blank" rel="noreferrer noopener" className="font-mono text-xs underline">
                {receipt.tx_hash}
              </a>
            </dd>
            <dt className="font-medium">From</dt>
            <dd className="break-all font-mono text-xs">{receipt.sender}</dd>
            <dt className="font-medium">Block</dt>
            <dd>
              {receipt.block_number} · {new Date(receipt.block_timestamp).toUTCString()}
            </dd>
            <dt className="font-medium">Verified</dt>
            <dd>
              {new Date(receipt.verified_at).toUTCString()} with {receipt.confirmations} confirmations
            </dd>
          </dl>
          <p className="text-xs opacity-80">
            Confirmations count blocks built on top of the one containing the payment. StableFlow
            waits for 3 and at least 30 seconds of chain time as a demo policy; this is not a guarantee of final settlement.
          </p>
        </section>
      )}

      {attempts && attempts.length > 0 && (
        <section aria-labelledby="attempts-heading" className="flex flex-col gap-2">
          <h2 id="attempts-heading" className="text-lg font-semibold">
            Submitted transactions
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {attempts.map((attempt) => (
              <li key={attempt.tx_hash} className="flex flex-col">
                <span className="break-all font-mono text-xs">{attempt.tx_hash}</span>
                <span>
                  {attempt.status === "verified" && "Verified"}
                  {attempt.status === "pending" && `Confirming (${Math.min(attempt.confirmations, 3)} of 3 blocks, and at least 30 seconds)`}
                  {attempt.status === "submitted" && "Waiting to appear on chain"}
                  {attempt.status === "rejected" && `Not accepted — ${rejectionMessage(attempt.error_code)}`}
                </span>
              </li>
            ))}
          </ul>
          {hasUnfinished && <CheckPayment requestId={request.id} />}
        </section>
      )}

      {status === "open" && !hasUnfinished && <RequestActions requestId={request.id} />}

      {status === "under_review" && (
        <section aria-labelledby="review-heading" className="flex flex-col gap-2 rounded-md border border-amber-700/60 p-4">
          <h2 id="review-heading" className="text-lg font-semibold">
            Under review
          </h2>
          <p className="text-sm">
            When StableFlow re-checked this payment on Base Sepolia, the transaction or its block was no longer on the
            canonical chain (for example, after a chain reorganization). Quotes and payout simulations are blocked. The
            original receipt and history are kept below.
          </p>
        </section>
      )}

      {(status === "confirmed" || (status === "under_review" && simulationView)) && (
        <PayoutPanel
          requestId={request.id}
          initialQuote={status === "confirmed" ? (quoteViews[0] ?? null) : null}
          initialSimulation={simulationView}
          simulationQuote={simulationQuote}
        />
      )}

      {events && events.length > 0 && <History events={events} />}
    </>
  );
}
