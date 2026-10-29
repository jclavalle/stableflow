/**
 * Illustrative BRL payout quote. Fixed fictional assumptions — not live
 * prices, provider quotes, promises or taxes. All arithmetic is on integers
 * (bigint); rounding is specified at each step:
 *
 *   service_fee  = ceil(input * service_fee_bps / 10000)            USDC units, rounded up
 *   net          = input - service_fee - fixed_fee                   must stay > 0
 *   effective    = floor(reference * (10000 - spread_bps) / 10000)   scaled BRL per USD, down
 *   output_minor = floor(net * effective * 100 / (1e6 * fx_scale))   BRL cents, rounded down
 *
 * 1 test USDC is treated as 1.00 USD solely for this arithmetic.
 */
export const QUOTE_ASSUMPTIONS = {
  version: "illustrative-2026-10.1",
  currency: "BRL",
  /** Rates are stored as integers scaled by this factor (4 decimal places). */
  fxScale: BigInt(10_000),
  /** 5.0000 BRL per USD, fixed and fictional. */
  referenceRateScaled: BigInt(50_000),
  /** 1% haircut to the reference rate. */
  spreadBps: BigInt(100),
  /** 0.5% of the input notional. */
  serviceFeeBps: BigInt(50),
  /** 0.50 USD equivalent, in USDC base units. */
  fixedFeeUnits: BigInt(500_000),
  validitySeconds: 5 * 60,
} as const;

const BPS = BigInt(10_000);
const USDC_UNIT = BigInt(1_000_000);

export type QuoteFigures = {
  inputUnits: bigint;
  serviceFeeBps: bigint;
  serviceFeeUnits: bigint;
  fixedFeeUnits: bigint;
  netUnits: bigint;
  fxScale: bigint;
  referenceRateScaled: bigint;
  spreadBps: bigint;
  effectiveRateScaled: bigint;
  outputMinor: bigint;
};

export type QuoteResult =
  | { ok: true; figures: QuoteFigures }
  | { ok: false; error: "invalid_input" | "fees_exceed_amount" | "payout_too_small" };

const ceilDiv = (a: bigint, b: bigint) => (a + b - BigInt(1)) / b;

export function computeQuote(inputUnits: bigint, assumptions = QUOTE_ASSUMPTIONS): QuoteResult {
  if (inputUnits <= BigInt(0)) return { ok: false, error: "invalid_input" };

  const serviceFeeUnits = ceilDiv(inputUnits * assumptions.serviceFeeBps, BPS);
  const netUnits = inputUnits - serviceFeeUnits - assumptions.fixedFeeUnits;
  // Never clamp: a request too small to cover the fees gets no quote.
  if (netUnits <= BigInt(0)) return { ok: false, error: "fees_exceed_amount" };

  const effectiveRateScaled = (assumptions.referenceRateScaled * (BPS - assumptions.spreadBps)) / BPS;
  const outputMinor = (netUnits * effectiveRateScaled * BigInt(100)) / (USDC_UNIT * assumptions.fxScale);
  if (outputMinor <= BigInt(0)) return { ok: false, error: "payout_too_small" };

  return {
    ok: true,
    figures: {
      inputUnits,
      serviceFeeBps: assumptions.serviceFeeBps,
      serviceFeeUnits,
      fixedFeeUnits: assumptions.fixedFeeUnits,
      netUnits,
      fxScale: assumptions.fxScale,
      referenceRateScaled: assumptions.referenceRateScaled,
      spreadBps: assumptions.spreadBps,
      effectiveRateScaled,
      outputMinor,
    },
  };
}

/** "490.05" for 49005 cents. Cents are never rounded again for display. */
export function formatBrlMinor(minor: bigint | string | number): string {
  const value = BigInt(minor);
  const sign = value < BigInt(0) ? "-" : "";
  const abs = value < BigInt(0) ? -value : value;
  const whole = (abs / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${whole}.${(abs % BigInt(100)).toString().padStart(2, "0")}`;
}

/** "4.95" for 49500 at scale 10000: at least 2 decimals, trailing zeros trimmed. */
export function formatScaledRate(value: bigint | string | number, scale: bigint | string | number): string {
  const v = BigInt(value);
  const s = BigInt(scale);
  const digits = s.toString().length - 1;
  const whole = v / s;
  let fraction = (v % s).toString().padStart(digits, "0").replace(/0+$/, "");
  if (fraction.length < 2) fraction = fraction.padEnd(2, "0");
  return `${whole}.${fraction}`;
}

/** "0.5%" for 50 basis points. */
export function formatBps(bps: bigint | string | number): string {
  const value = BigInt(bps);
  const whole = value / BigInt(100);
  const fraction = (value % BigInt(100)).toString().padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}%` : `${whole}%`;
}
