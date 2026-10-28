"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CheckPayment({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function check() {
    setPending(true);
    setMessage(null);
    const response = await fetch(`/api/requests/${requestId}/verify`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setMessage(data?.error?.message ?? "Verification is unavailable right now. Try again.");
      return;
    }
    if (data.unavailable) setMessage("Base Sepolia can’t be reached right now; nothing changed. Try again shortly.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={check}
        disabled={pending}
        className="self-start rounded-md border border-current/40 px-3 py-2 text-sm disabled:opacity-60"
      >
        {pending ? "Checking…" : "Check payment status"}
      </button>
      <p role="status" aria-live="polite" className="text-sm">
        {message}
      </p>
    </div>
  );
}
