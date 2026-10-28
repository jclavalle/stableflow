"use client";

import { useCallback, useEffect, useState } from "react";
import { erc20Abi, formatEther, getAddress, type Hex } from "viem";
import {
  useBalance,
  useConnect,
  useConnection,
  useConnectors,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { BASE_SEPOLIA, TEST_USDC } from "@/lib/chain/allowlist";
import { formatUsdcUnits } from "@/lib/payments/amount";
import { rejectionMessage } from "@/lib/payments/labels";
import type { PublicPaymentRequest } from "@/lib/payments/requests";
import type { AttemptView } from "@/lib/payments/verification";

const FAUCETS = {
  usdc: "https://faucet.circle.com",
  eth: "https://docs.base.org/get-started/get-funds",
};

// Client-side retry schedule for verification (ms). Bounded; then manual.
const BACKOFF = [2_000, 3_000, 5_000, 8_000, 13_000, 20_000, 30_000, 30_000, 30_000, 30_000];

const isUnfinished = (attempt: AttemptView) => attempt.status === "submitted" || attempt.status === "pending";

type Phase =
  | { kind: "ready" }
  | { kind: "signing" }
  | { kind: "tracking"; attempt: AttemptView }
  | { kind: "error"; message: string };

function walletErrorMessage(error: unknown): string {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/reject|denied|cancel/i.test(text)) {
    return "You declined the transaction in your wallet. Nothing was sent; you can try again.";
  }
  if (/insufficient funds|exceeds balance|gas/i.test(text)) {
    return "Your wallet doesn’t have enough test ETH for gas or enough test USDC. Use the faucets below, then try again.";
  }
  return "The wallet could not send the transaction. Nothing was recorded; you can try again.";
}

async function postJson(path: string, body: unknown): Promise<{ attempt: AttemptView }> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? "Verification is unavailable right now.");
  return data;
}

export function PayWithWallet({
  token,
  request,
  initialAttempt,
}: {
  token: string;
  request: PublicPaymentRequest;
  initialAttempt: AttemptView | null;
}) {
  const { address, isConnected, chainId } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const switchChain = useSwitchChain();
  const writeContract = useWriteContract();

  const [phase, setPhase] = useState<Phase>(
    initialAttempt ? { kind: "tracking", attempt: initialAttempt } : { kind: "ready" },
  );
  const [checkError, setCheckError] = useState<string | null>(null);
  // Which transaction to poll; a new object restarts the backoff schedule.
  const [poll, setPoll] = useState<{ txHash: string } | null>(
    initialAttempt && isUnfinished(initialAttempt) ? { txHash: initialAttempt.txHash } : null,
  );

  const amount = BigInt(request.amountUnits);
  const recipient = getAddress(request.recipient);
  const tokenMatchesAllowlist = request.tokenAddress.toLowerCase() === TEST_USDC.address.toLowerCase();
  const onRightChain = chainId === BASE_SEPOLIA.chainId;

  const usdcBalance = useReadContract({
    address: TEST_USDC.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: BASE_SEPOLIA.chainId,
    query: { enabled: Boolean(address) && onRightChain },
  });
  const ethBalance = useBalance({
    address,
    chainId: BASE_SEPOLIA.chainId,
    query: { enabled: Boolean(address) && onRightChain },
  });

  const check = useCallback(
    async (txHash: string) => {
      try {
        const { attempt } = await postJson(`/api/pay/${token}/verify`, { txHash });
        setCheckError(attempt.unavailable ? "We can’t reach Base Sepolia to verify right now. Your transaction is saved." : null);
        setPhase({ kind: "tracking", attempt });
        return attempt;
      } catch (error) {
        setCheckError(error instanceof Error ? error.message : "Verification is unavailable right now.");
        return null;
      }
    },
    [token],
  );

  // Poll with bounded backoff while the attempt is unfinished. Server state is
  // authoritative; reloading the page resumes from it.
  useEffect(() => {
    if (!poll) return;
    let cancelled = false;
    let handle: ReturnType<typeof setTimeout> | undefined;
    let step = 0;
    function next() {
      const delay = BACKOFF[step++];
      if (delay === undefined || cancelled) return;
      handle = setTimeout(async () => {
        const attempt = await check(poll!.txHash);
        if (!cancelled && (!attempt || isUnfinished(attempt))) next();
      }, delay);
    }
    next();
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [poll, check]);

  async function pay() {
    if (!address) return;
    setPhase({ kind: "signing" });
    let hash: Hex;
    try {
      hash = await writeContract.mutateAsync({
        address: TEST_USDC.address,
        abi: erc20Abi,
        functionName: "transfer",
        args: [recipient, amount],
        chainId: BASE_SEPOLIA.chainId,
      });
    } catch (error) {
      setPhase({ kind: "error", message: walletErrorMessage(error) });
      return;
    }
    try {
      const { attempt } = await postJson(`/api/pay/${token}/attempts`, { txHash: hash });
      setPhase({ kind: "tracking", attempt });
      setCheckError(attempt.unavailable ? "We can’t reach Base Sepolia to verify right now. Your transaction is saved." : null);
      if (isUnfinished(attempt)) setPoll({ txHash: hash });
    } catch (error) {
      // The transfer may still be on chain; keep the hash visible for retry.
      setPhase({ kind: "tracking", attempt: { txHash: hash, status: "submitted", errorCode: null, confirmations: 0, requiredConfirmations: 3, unavailable: true } });
      setCheckError(error instanceof Error ? error.message : "Could not record the transaction yet.");
    }
  }

  if (!tokenMatchesAllowlist) {
    return <p role="alert">This request uses an unexpected token and can’t be paid here.</p>;
  }

  if (phase.kind === "tracking") {
    return (
      <PaymentProgress
        attempt={phase.attempt}
        checkError={checkError}
        onCheckAgain={() => {
          void check(phase.attempt.txHash).then((attempt) => {
            if (attempt && isUnfinished(attempt)) setPoll({ txHash: attempt.txHash });
          });
        }}
        onStartOver={() => {
          setPoll(null);
          setPhase({ kind: "ready" });
        }}
      />
    );
  }

  const usdc = usdcBalance.data;
  const eth = ethBalance.data?.value;
  const notEnoughUsdc = usdc !== undefined && usdc < amount;
  const noGas = eth !== undefined && eth === BigInt(0);

  return (
    <section aria-labelledby="pay-heading" className="flex flex-col gap-4 rounded-md border border-current/20 p-4">
      <h2 id="pay-heading" className="text-lg font-semibold">
        Pay with a test wallet
      </h2>

      {!isConnected ? (
        <>
          <p className="text-sm">
            Connect a <strong>test wallet</strong> that holds Base Sepolia test USDC and a little
            test ETH for gas. Never use a wallet that holds real funds.
          </p>
          <button
            type="button"
            className="self-start rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
            disabled={connect.isPending}
            onClick={() => {
              const connector = connectors[0];
              if (!connector) {
                setPhase({ kind: "error", message: "No browser wallet found. Install a wallet extension to pay." });
                return;
              }
              connect.mutate({ connector }, { onError: (error) => setPhase({ kind: "error", message: walletErrorMessage(error) }) });
            }}
          >
            Connect wallet
          </button>
        </>
      ) : !onRightChain ? (
        <>
          <p role="alert" className="text-sm">
            Your wallet is on a different network. Switch to <strong>{BASE_SEPOLIA.name}</strong> to
            pay. Sending on another network would not reach this request.
          </p>
          <button
            type="button"
            className="self-start rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
            disabled={switchChain.isPending}
            onClick={() =>
              switchChain.mutate(
                { chainId: BASE_SEPOLIA.chainId },
                { onError: (error) => setPhase({ kind: "error", message: walletErrorMessage(error) }) },
              )
            }
          >
            Switch to {BASE_SEPOLIA.name}
          </button>
        </>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="font-medium">From</dt>
            <dd className="break-all font-mono text-xs">{address}</dd>
            <dt className="font-medium">To</dt>
            <dd className="break-all font-mono text-xs">{recipient}</dd>
            <dt className="font-medium">Amount</dt>
            <dd>
              Exactly {request.amountDisplay} test USDC
            </dd>
            <dt className="font-medium">Your balances</dt>
            <dd>
              {usdc === undefined ? "…" : `${formatUsdcUnits(usdc)} test USDC`} ·{" "}
              {eth === undefined ? "…" : `${Number(formatEther(eth)).toFixed(4)} test ETH`}
            </dd>
          </dl>
          <p className="text-xs opacity-80">
            Gas is paid separately in test ETH by your wallet. Testnet gas costs say nothing about
            mainnet costs.
          </p>
          {(notEnoughUsdc || noGas) && (
            <p role="alert" className="text-sm">
              {notEnoughUsdc && "Not enough test USDC for this payment. "}
              {noGas && "No test ETH for gas. "}
              Get free test tokens from the{" "}
              <a href={FAUCETS.usdc} target="_blank" rel="noreferrer noopener" className="underline">
                Circle USDC faucet
              </a>{" "}
              and a{" "}
              <a href={FAUCETS.eth} target="_blank" rel="noreferrer noopener" className="underline">
                Base Sepolia ETH faucet
              </a>
              .
            </p>
          )}
          <button
            type="button"
            className="self-start rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
            disabled={phase.kind === "signing" || notEnoughUsdc}
            onClick={pay}
          >
            {phase.kind === "signing" ? "Confirm in your wallet…" : `Send ${request.amountDisplay} test USDC`}
          </button>
        </>
      )}

      {phase.kind === "error" && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {phase.message}
        </p>
      )}
    </section>
  );
}

function PaymentProgress({
  attempt,
  checkError,
  onCheckAgain,
  onStartOver,
}: {
  attempt: AttemptView;
  checkError: string | null;
  onCheckAgain: () => void;
  onStartOver: () => void;
}) {
  const explorer = `${BASE_SEPOLIA.explorerUrl}/tx/${attempt.txHash}`;
  const steps = [
    { label: "Submitted", done: true },
    { label: "Found on chain", done: attempt.status === "pending" || attempt.status === "verified" },
    {
      label:
        attempt.status === "verified"
          ? `Confirmed (${attempt.requiredConfirmations}+ blocks)`
          : `Confirming (${Math.min(attempt.confirmations, attempt.requiredConfirmations)} of ${attempt.requiredConfirmations} blocks)`,
      done: attempt.status === "verified",
    },
  ];

  return (
    <section aria-labelledby="progress-heading" className="flex flex-col gap-3 rounded-md border border-current/20 p-4">
      <h2 id="progress-heading" className="text-lg font-semibold">
        {attempt.status === "verified"
          ? "Payment verified on Base Sepolia"
          : attempt.status === "rejected"
            ? "This transaction doesn’t match the request"
            : "Verifying your payment…"}
      </h2>
      {attempt.status !== "rejected" && (
        <ol className="flex flex-col gap-1 text-sm">
          {steps.map((step) => (
            <li key={step.label}>
              <span aria-hidden="true">{step.done ? "✓" : "○"}</span> {step.label}
            </li>
          ))}
        </ol>
      )}
      <p role="status" aria-live="polite" className="text-sm">
        {attempt.status === "verified" &&
          "StableFlow checked the transaction on chain: the right token, recipient and exact amount. Test USDC has no financial value."}
        {attempt.status === "rejected" && rejectionMessage(attempt.errorCode)}
        {(attempt.status === "submitted" || attempt.status === "pending") &&
          "Submitting a transaction doesn’t mean it’s paid. StableFlow waits for confirmations, then verifies it independently."}
      </p>
      <p className="break-all text-xs">
        Transaction:{" "}
        <a href={explorer} target="_blank" rel="noreferrer noopener" className="font-mono underline">
          {attempt.txHash}
        </a>
      </p>
      {checkError && (
        <p role="alert" className="text-sm">
          {checkError}
        </p>
      )}
      {(attempt.status === "submitted" || attempt.status === "pending") && (
        <button type="button" onClick={onCheckAgain} className="self-start rounded-md border border-current/40 px-3 py-1 text-sm">
          Check again
        </button>
      )}
      {attempt.status === "rejected" && (
        <button type="button" onClick={onStartOver} className="self-start rounded-md border border-current/40 px-3 py-1 text-sm">
          Try a new payment
        </button>
      )}
    </section>
  );
}
