import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { formatUsdcUnits } from "@/lib/payments/amount";
import { STATUS_LABELS } from "@/lib/payments/labels";
import { effectiveStatus, type RequestStatus } from "@/lib/payments/requests";
import { createUserClient, getCurrentUser } from "@/lib/supabase/server";

import { CreateRequestForm } from "./CreateRequestForm";

export const metadata: Metadata = { title: "Payment requests — StableFlow" };

export default function RequestsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Payment requests</h1>
      <Suspense fallback={<p>Loading your requests…</p>}>
        <Requests />
      </Suspense>
    </main>
  );
}

async function Requests() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  // User-scoped client: RLS limits both queries to this user's rows.
  const supabase = await createUserClient();
  const [wallets, requests] = await Promise.all([
    supabase.from("wallets").select("id, address").order("verified_at", { ascending: false }),
    supabase
      .from("payment_requests")
      .select("id, amount_units::text, status, created_at, expires_at")
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<
        { id: string; amount_units: string; status: RequestStatus; created_at: string; expires_at: string }[]
      >(),
  ]);

  if (wallets.error || requests.error) {
    return (
      <p role="alert" className="text-sm">
        Could not load your requests. Refresh to try again.
      </p>
    );
  }

  const now = new Date();

  return (
    <>
      <section aria-labelledby="new-heading" className="flex flex-col gap-4">
        <h2 id="new-heading" className="text-lg font-semibold">
          New request
        </h2>
        {wallets.data.length > 0 ? (
          <CreateRequestForm wallets={wallets.data} />
        ) : (
          <p className="text-sm">
            Link a test wallet on your <Link href="/account" className="underline">account page</Link>{" "}
            first. Payments are sent to a wallet you have proven you control.
          </p>
        )}
      </section>

      <section aria-labelledby="list-heading" className="flex flex-col gap-3">
        <h2 id="list-heading" className="text-lg font-semibold">
          Your requests
        </h2>
        {requests.data.length === 0 ? (
          <p className="text-sm">No requests yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-current/10">
            {requests.data.map((request) => (
              <li key={request.id} className="py-2">
                <Link href={`/requests/${request.id}`} className="flex flex-wrap justify-between gap-2 underline-offset-4 hover:underline">
                  <span className="font-medium">{formatUsdcUnits(request.amount_units)} test USDC</span>
                  <span className="text-sm">{STATUS_LABELS[effectiveStatus(request, now)]}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
