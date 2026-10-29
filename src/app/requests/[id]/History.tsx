import { SIMULATION_LABEL } from "@/lib/payouts/views";
import { formatBrlMinor } from "@/lib/quotes/fx";

export type HistoryEvent = {
  id: string;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

const PAYMENT_EVENTS: Record<string, string> = {
  "request.created": "Request created",
  "request.link_regenerated": "Payment link replaced",
  "request.cancelled": "Request cancelled",
  "payment.attempt_submitted": "Transaction submitted by payer (not yet verified)",
  "payment.attempt_rejected": "Submitted transaction not accepted",
  "payment.confirmed": "Payment verified on Base Sepolia",
  "payment.evidence_invalidated": "Payment evidence no longer on the canonical chain — under review",
};

const PAYOUT_EVENTS: Record<string, string> = {
  "payout.quote_created": "Illustrative BRL quote created",
  "payout.simulation_created": "Payout simulation started",
  "payout.simulation_processing": "Payout simulation processing",
  "payout.simulation_completed": "Payout simulation complete",
  "payout.simulation_failed": "Payout simulation stopped",
};

function payoutDetail(event: HistoryEvent) {
  const output = event.metadata.output_minor;
  return typeof output === "string" && /^\d+$/.test(output) ? ` — BRL ${formatBrlMinor(output)}` : "";
}

/** Blockchain evidence and simulated payout events, kept visibly apart. */
export function History({ events }: { events: HistoryEvent[] }) {
  const payment = events.filter((e) => e.event_type in PAYMENT_EVENTS);
  const payout = events.filter((e) => e.event_type in PAYOUT_EVENTS);

  return (
    <section aria-labelledby="history-heading" className="flex flex-col gap-4">
      <h2 id="history-heading" className="text-lg font-semibold">
        History
      </h2>
      <div className="flex flex-col gap-2">
        <h3 className="font-medium">Request and blockchain evidence (Base Sepolia testnet)</h3>
        <ol className="flex flex-col gap-1 text-sm">
          {payment.map((event) => (
            <li key={event.id}>
              <time dateTime={event.created_at} className="opacity-80">
                {new Date(event.created_at).toUTCString()}
              </time>{" "}
              · {PAYMENT_EVENTS[event.event_type]}
            </li>
          ))}
        </ol>
      </div>
      {payout.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">Payout simulation ({SIMULATION_LABEL})</h3>
          <ol className="flex flex-col gap-1 text-sm">
            {payout.map((event) => (
              <li key={event.id}>
                <time dateTime={event.created_at} className="opacity-80">
                  {new Date(event.created_at).toUTCString()}
                </time>{" "}
                · {PAYOUT_EVENTS[event.event_type]}
                {payoutDetail(event)} <span className="text-xs">({SIMULATION_LABEL})</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
