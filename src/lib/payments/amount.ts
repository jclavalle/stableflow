import { TEST_USDC } from "@/lib/chain/allowlist";

const DECIMALS = TEST_USDC.decimals;
const SCALE = BigInt(10) ** BigInt(DECIMALS);

/** Demo cap: 1,000,000 test USDC. Keeps values well inside safe ranges. */
export const MAX_AMOUNT_UNITS = BigInt(1_000_000) * SCALE;

export type AmountError =
  | "empty"
  | "comma_decimal"
  | "invalid_format"
  | "too_many_decimals"
  | "zero"
  | "too_large";

export const AMOUNT_ERROR_MESSAGES: Record<AmountError, string> = {
  empty: "Enter an amount.",
  comma_decimal: "Use a dot for decimals, for example 100.50.",
  invalid_format: "Enter a plain number, for example 100 or 100.50.",
  too_many_decimals: `USDC supports at most ${DECIMALS} decimal places.`,
  zero: "The amount must be greater than zero.",
  too_large: "The maximum for this demo is 1,000,000 USDC.",
};

/**
 * Parses a human USDC amount into integer base units without floating point.
 * Accepts digits with an optional dot and up to six decimals; rejects signs,
 * exponents, separators, zero and amounts over the demo cap.
 */
export function parseUsdcAmount(
  input: string,
): { ok: true; units: bigint } | { ok: false; error: AmountError } {
  const value = input.trim();
  if (value === "") return { ok: false, error: "empty" };
  if (value.length > 32) return { ok: false, error: "invalid_format" };
  if (/^\d+,\d+$/.test(value)) return { ok: false, error: "comma_decimal" };

  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return { ok: false, error: "invalid_format" };

  const [, whole, fraction = ""] = match;
  if (fraction.length > DECIMALS) return { ok: false, error: "too_many_decimals" };

  const units = BigInt(whole) * SCALE + BigInt(fraction.padEnd(DECIMALS, "0") || "0");
  if (units === BigInt(0)) return { ok: false, error: "zero" };
  if (units > MAX_AMOUNT_UNITS) return { ok: false, error: "too_large" };
  return { ok: true, units };
}

/** Formats base units for display: at least two decimals, trailing zeros trimmed beyond that. */
export function formatUsdcUnits(units: bigint | string): string {
  const value = BigInt(units);
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}.${fraction.padEnd(2, "0")}`;
}
