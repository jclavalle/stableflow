// Shapes shared by the payout API routes, the request page and the client panel.
// Amounts travel as decimal strings; never JS numbers.

export type QuoteView = {
  id: string;
  inputUnits: string;
  serviceFeeBps: number;
  serviceFeeUnits: string;
  fixedFeeUnits: string;
  netUnits: string;
  fxScale: number;
  referenceRateScaled: number;
  spreadBps: number;
  effectiveRateScaled: number;
  outputMinor: string;
  currency: "BRL";
  assumptionsVersion: string;
  createdAt: string;
  expiresAt: string;
};

export type SimulationStatus = "created" | "processing" | "completed_simulation" | "failed_simulation";

export type SimulationView = {
  id: string;
  quoteId: string;
  status: SimulationStatus;
  failureCode: string | null;
  createdAt: string;
  processingAt: string | null;
  completedAt: string | null;
};

export const QUOTE_COLUMNS =
  "id, input_units::text, service_fee_bps, service_fee_units::text, fixed_fee_units::text, net_units::text, " +
  "fx_scale, reference_rate_scaled, spread_bps, effective_rate_scaled, output_minor::text, currency, " +
  "assumptions_version, created_at, expires_at";

export const SIMULATION_COLUMNS = "id, quote_id, status, failure_code, created_at, processing_at, completed_at";

export type QuoteRow = {
  id: string;
  input_units: string;
  service_fee_bps: number;
  service_fee_units: string;
  fixed_fee_units: string;
  net_units: string;
  fx_scale: number;
  reference_rate_scaled: number;
  spread_bps: number;
  effective_rate_scaled: number;
  output_minor: string;
  currency: "BRL";
  assumptions_version: string;
  created_at: string;
  expires_at: string;
};

export type SimulationRow = {
  id: string;
  quote_id: string;
  status: SimulationStatus;
  failure_code: string | null;
  created_at: string;
  processing_at: string | null;
  completed_at: string | null;
};

export function toQuoteView(row: QuoteRow): QuoteView {
  return {
    id: row.id,
    inputUnits: row.input_units,
    serviceFeeBps: row.service_fee_bps,
    serviceFeeUnits: row.service_fee_units,
    fixedFeeUnits: row.fixed_fee_units,
    netUnits: row.net_units,
    fxScale: row.fx_scale,
    referenceRateScaled: row.reference_rate_scaled,
    spreadBps: row.spread_bps,
    effectiveRateScaled: row.effective_rate_scaled,
    outputMinor: row.output_minor,
    currency: row.currency,
    assumptionsVersion: row.assumptions_version,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function toSimulationView(row: SimulationRow): SimulationView {
  return {
    id: row.id,
    quoteId: row.quote_id,
    status: row.status,
    failureCode: row.failure_code,
    createdAt: row.created_at,
    processingAt: row.processing_at,
    completedAt: row.completed_at,
  };
}

export const isTerminal = (status: SimulationStatus) =>
  status === "completed_simulation" || status === "failed_simulation";

export const SIMULATION_LABEL = "Simulated — no bank transfer";

export const SIMULATION_STATUS_LABELS: Record<SimulationStatus, string> = {
  created: "Simulation created",
  processing: "Simulation processing",
  completed_simulation: "Simulation complete — no bank transfer occurred",
  failed_simulation: "Simulation stopped — no bank transfer occurred",
};

export const FAILURE_MESSAGES: Record<string, string> = {
  evidence_invalidated:
    "The blockchain evidence for this payment changed (for example, a chain reorganization), so the simulation was stopped and the request is under review.",
};
