"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  FAILURE_MESSAGES,
  isTerminal,
  SIMULATION_LABEL,
  SIMULATION_STATUS_LABELS,
  type QuoteView,
  type SimulationView,
} from "@/lib/payouts/views";
import { formatBrlMinor } from "@/lib/quotes/fx";

import { QuoteBreakdown } from "./QuoteBreakdown";

const POLL_MS = 1_000;
const MAX_POLLS = 90;

type Props = {
  requestId: string;
  initialQuote: QuoteView | null;
  initialSimulation: SimulationView | null;
  /** The quote the simulation used, when there is one. */
  simulationQuote: QuoteView | null;
};

async function postJson(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data };
}

export function PayoutPanel({ requestId, initialQuote, initialSimulation, simulationQuote }: Props) {
  const router = useRouter();
  const [quote, setQuote] = useState(initialQuote);
  const [simulation, setSimulation] = useState(initialSimulation);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  // One key per page visit: a retried click can never start a second simulation.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  // Display clock only; the server decides whether a quote has expired.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  const onSimulationUpdate = useCallback(
    (next: SimulationView) => {
      setSimulation(next);
      if (isTerminal(next.status)) router.refresh();
    },
    [router],
  );

  async function getQuote() {
    setPending(true);
    setError(null);
    const { ok, data } = await postJson(`/api/requests/${requestId}/quote`);
    setPending(false);
    if (!ok) {
      setError(data?.error?.message ?? "Couldn’t create a quote. Try again.");
      return;
    }
    setQuote(data.quote);
  }

  async function startSimulation() {
    if (!quote) return;
    setPending(true);
    setError(null);
    const { ok, data } = await postJson(`/api/quotes/${quote.id}/simulate`, { idempotencyKey });
    setPending(false);
    if (!ok) {
      setError(data?.error?.message ?? "Couldn’t start the simulation. Try again.");
      if (data?.error?.code === "evidence_invalidated") router.refresh();
      return;
    }
    setSimulation(data.simulation);
  }

  if (simulation) {
    return (
      <SimulationProgress
        simulation={simulation}
        quote={simulationQuote ?? quote}
        onUpdate={onSimulationUpdate}
      />
    );
  }

  const expired = quote !== null && now !== null && new Date(quote.expiresAt).getTime() <= now;
  const secondsLeft = quote && now !== null ? Math.max(0, Math.ceil((new Date(quote.expiresAt).getTime() - now) / 1000)) : null;

  return (
    <section aria-labelledby="payout-heading" className="flex flex-col gap-3 rounded-md border border-current/20 p-4">
      <h2 id="payout-heading" className="text-lg font-semibold">
        Illustrative BRL payout <span className="text-sm font-normal">({SIMULATION_LABEL})</span>
      </h2>
      {!quote && (
        <p className="text-sm">
          See what this testnet payment could look like as a local BRL payout, using fixed fictional fees and rates. Nothing
          is converted, swapped or sent to a bank.
        </p>
      )}
      {quote && <QuoteBreakdown quote={quote} />}
      {quote && !expired && secondsLeft !== null && (
        <p className="text-sm" aria-live="off">
          Quote valid for {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")} (until{" "}
          {new Date(quote.expiresAt).toUTCString()}).
        </p>
      )}
      {expired && (
        <p role="status" className="text-sm">
          This quote expired. Get a new quote to continue.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {(!quote || expired) && (
          <button
            type="button"
            onClick={getQuote}
            disabled={pending}
            className="rounded-md border border-current/40 px-3 py-2 text-sm disabled:opacity-60"
          >
            {quote ? "Get a new quote" : "Get illustrative BRL quote"}
          </button>
        )}
        {quote && !expired && (
          <button
            type="button"
            onClick={startSimulation}
            disabled={pending || now === null}
            className="rounded-md border border-current/40 px-3 py-2 text-sm font-medium disabled:opacity-60"
          >
            {pending ? "Starting…" : `Start simulated payout of BRL ${formatBrlMinor(quote.outputMinor)}`}
          </button>
        )}
      </div>
      {quote && !expired && (
        <p className="text-xs opacity-80">
          Starting a simulation does not send money, debit any balance or ask for bank details. One simulation per request.
        </p>
      )}
    </section>
  );
}

function SimulationProgress({
  simulation,
  quote,
  onUpdate,
}: {
  simulation: SimulationView;
  quote: QuoteView | null;
  onUpdate: (next: SimulationView) => void;
}) {
  const [polls, setPolls] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const terminal = isTerminal(simulation.status);
  const stalled = !terminal && polls >= MAX_POLLS;

  // Ask the server to apply due transitions; reload resumes from stored state.
  useEffect(() => {
    if (terminal || stalled) return;
    const timer = setTimeout(async () => {
      const { ok, data } = await postJson(`/api/simulations/${simulation.id}/advance`);
      setPolls((n) => n + 1);
      if (!ok) {
        setMessage(data?.error?.message ?? "Couldn’t update the simulation. Retrying…");
        return;
      }
      setMessage(data.unavailable ? "Re-checking the payment on Base Sepolia… the chain can’t be reached right now." : null);
      onUpdate(data.simulation);
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [simulation, terminal, stalled, polls, onUpdate]);

  const reached = (status: SimulationView["status"][]) => status.includes(simulation.status);
  const steps = [
    { label: "Created", done: true },
    { label: "Processing (simulated)", done: reached(["processing", "completed_simulation"]) },
    { label: "Completed (simulated)", done: reached(["completed_simulation"]) },
  ];

  return (
    <section aria-labelledby="simulation-heading" className="flex flex-col gap-3 rounded-md border border-current/20 p-4">
      <h2 id="simulation-heading" className="text-lg font-semibold">
        Payout simulation <span className="text-sm font-normal">({SIMULATION_LABEL})</span>
      </h2>
      {simulation.status !== "failed_simulation" && (
        <ol className="flex flex-col gap-1 text-sm">
          {steps.map((step) => (
            <li key={step.label}>
              <span aria-hidden="true">{step.done ? "✓" : "○"}</span> {step.label}
            </li>
          ))}
        </ol>
      )}
      <p role="status" aria-live="polite" className="text-sm font-medium">
        {simulation.status === "completed_simulation"
          ? "Simulation complete — no bank transfer occurred."
          : SIMULATION_STATUS_LABELS[simulation.status]}
      </p>
      {simulation.status === "failed_simulation" && (
        <p className="text-sm">{FAILURE_MESSAGES[simulation.failureCode ?? ""] ?? "The simulation stopped."}</p>
      )}
      {quote && (
        <p className="text-sm">
          Illustrative amount: BRL {formatBrlMinor(quote.outputMinor)} from {quote.assumptionsVersion}. No real BRL was paid
          and no bank details were collected.
        </p>
      )}
      {message && <p className="text-sm">{message}</p>}
      {stalled && (
        <button
          type="button"
          onClick={() => setPolls(0)}
          className="self-start rounded-md border border-current/40 px-3 py-1 text-sm"
        >
          Check again
        </button>
      )}
    </section>
  );
}
