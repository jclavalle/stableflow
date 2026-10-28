"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useConnect, useConnection, useConnectors, useSignMessage } from "wagmi";

type Status =
  | { kind: "idle" }
  | { kind: "working"; step: string }
  | { kind: "error"; message: string }
  | { kind: "linked" };

async function postJson(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message ?? "Something went wrong. Try again.");
  }
  return data;
}

export function LinkWallet() {
  const router = useRouter();
  const { address, isConnected } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const signMessage = useSignMessage();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function link() {
    try {
      let account = address;
      if (!isConnected || !account) {
        const connector = connectors[0];
        if (!connector) throw new Error("No browser wallet found. Install a wallet extension to continue.");
        setStatus({ kind: "working", step: "Connect your wallet…" });
        const result = await connect.mutateAsync({ connector });
        account = result.accounts[0];
      }

      setStatus({ kind: "working", step: "Preparing a sign-in message…" });
      const { message } = await postJson("/api/wallet/challenge", { address: account });

      setStatus({ kind: "working", step: "Approve the signature in your wallet…" });
      const signature = await signMessage.mutateAsync({ message, account });

      setStatus({ kind: "working", step: "Verifying…" });
      await postJson("/api/wallet/verify", { message, signature });

      setStatus({ kind: "linked" });
      router.refresh();
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      const message = /reject|denied/i.test(raw)
        ? "You declined the request in your wallet. Nothing was linked; you can try again."
        : raw || "Something went wrong. Try again.";
      setStatus({ kind: "error", message });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Use a dedicated <strong>test wallet</strong>. Linking asks you to sign a message — it
        sends no transaction, costs no gas, and StableFlow never asks for your seed phrase or
        private key.
      </p>
      <button
        type="button"
        onClick={link}
        disabled={status.kind === "working"}
        className="self-start rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
      >
        {isConnected ? "Link connected wallet" : "Connect and link wallet"}
      </button>
      <p role="status" aria-live="polite" className="text-sm">
        {status.kind === "working" && status.step}
        {status.kind === "linked" && "Wallet linked."}
      </p>
      {status.kind === "error" && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {status.message}
        </p>
      )}
    </div>
  );
}
