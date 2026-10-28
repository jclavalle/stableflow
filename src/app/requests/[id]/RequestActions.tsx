"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ShareLink } from "@/components/ShareLink";

export function RequestActions({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newLink, setNewLink] = useState<string | null>(null);

  async function post(path: string) {
    setPending(true);
    setError(null);
    const response = await fetch(path, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(data?.error?.message ?? "Something went wrong. Try again.");
      return null;
    }
    return data;
  }

  async function regenerate() {
    const data = await post(`/api/requests/${requestId}/link`);
    if (data) setNewLink(data.payUrl);
  }

  async function cancel() {
    if (!window.confirm("Cancel this request? Its payment link will stop working.")) return;
    const data = await post(`/api/requests/${requestId}/cancel`);
    if (data) {
      setNewLink(null);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {newLink && <ShareLink url={newLink} />}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={regenerate}
          disabled={pending}
          className="rounded-md border border-current/40 px-3 py-2 text-sm disabled:opacity-60"
        >
          {newLink ? "Create another new link" : "Create new payment link"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          className="rounded-md border border-red-700/60 px-3 py-2 text-sm text-red-800 disabled:opacity-60 dark:text-red-300"
        >
          Cancel request
        </button>
      </div>
      <p className="text-xs opacity-80">A new link disables the previous one immediately.</p>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
