"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ShareLink } from "@/components/ShareLink";
import { AMOUNT_ERROR_MESSAGES, parseUsdcAmount } from "@/lib/payments/amount";
import { EXPIRY_OPTIONS_DAYS } from "@/lib/payments/requests";

type Wallet = { id: string; address: string };

export function CreateRequestForm({ wallets }: { wallets: Wallet[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; payUrl: string } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = String(form.get("amount") ?? "");

    const parsed = parseUsdcAmount(amount);
    if (!parsed.ok) {
      setError(AMOUNT_ERROR_MESSAGES[parsed.error]);
      return;
    }

    setPending(true);
    setError(null);
    const response = await fetch("/api/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        walletId: form.get("walletId"),
        amount,
        expiresInDays: Number(form.get("expiresInDays")),
      }),
    });
    const data = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(data?.error?.message ?? "Could not create the request. Try again.");
      return;
    }
    setCreated(data);
    router.refresh();
  }

  if (created) {
    return (
      <div className="flex flex-col gap-3">
        <p role="status">Payment request created.</p>
        <ShareLink url={created.payUrl} />
        <div className="flex gap-4 text-sm">
          <a href={`/requests/${created.id}`} className="underline">
            View request
          </a>
          <button type="button" className="underline" onClick={() => setCreated(null)}>
            Create another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="amount" className="text-sm font-medium">
          Amount (test USDC)
        </label>
        <input
          id="amount"
          name="amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="100.00"
          required
          aria-describedby="amount-hint"
          className="rounded-md border border-current/30 bg-transparent px-3 py-2"
        />
        <p id="amount-hint" className="text-xs opacity-80">
          Up to 6 decimal places. The payer must send exactly this amount.
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="walletId" className="text-sm font-medium">
          Receive to
        </label>
        <select
          id="walletId"
          name="walletId"
          className="rounded-md border border-current/30 bg-transparent px-3 py-2 font-mono text-xs"
        >
          {wallets.map((wallet) => (
            <option key={wallet.id} value={wallet.id}>
              {wallet.address}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="expiresInDays" className="text-sm font-medium">
          Link expires after
        </label>
        <select
          id="expiresInDays"
          name="expiresInDays"
          defaultValue={3}
          className="rounded-md border border-current/30 bg-transparent px-3 py-2"
        >
          {EXPIRY_OPTIONS_DAYS.map((days) => (
            <option key={days} value={days}>
              {days} {days === 1 ? "day" : "days"}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
      >
        Create payment request
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}
