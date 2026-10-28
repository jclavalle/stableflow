import { describe, expect, it } from "vitest";

import { formatUsdcUnits, MAX_AMOUNT_UNITS, parseUsdcAmount } from "@/lib/payments/amount";

describe("parseUsdcAmount", () => {
  it.each([
    ["100", BigInt(100_000_000)],
    ["100.5", BigInt(100_500_000)],
    ["0.000001", BigInt(1)],
    ["1.234567", BigInt(1_234_567)],
    ["0007.10", BigInt(7_100_000)],
    ["  42  ", BigInt(42_000_000)],
    ["1000000", MAX_AMOUNT_UNITS],
  ])("parses %j exactly", (input, units) => {
    expect(parseUsdcAmount(input)).toEqual({ ok: true, units });
  });

  it("keeps precision where floating point would not (0.1 + 0.2 style)", () => {
    expect(parseUsdcAmount("0.3")).toEqual({ ok: true, units: BigInt(300_000) });
    expect(parseUsdcAmount("999999.999999")).toEqual({ ok: true, units: BigInt("999999999999") });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["0", "zero"],
    ["0.000000", "zero"],
    ["-5", "invalid_format"],
    ["+5", "invalid_format"],
    ["1e6", "invalid_format"],
    ["1E-6", "invalid_format"],
    ["0x10", "invalid_format"],
    ["1,000.00", "invalid_format"],
    ["100,50", "comma_decimal"],
    [".5", "invalid_format"],
    ["5.", "invalid_format"],
    ["1.2.3", "invalid_format"],
    ["Infinity", "invalid_format"],
    ["NaN", "invalid_format"],
    ["١٠٠", "invalid_format"],
    ["1.0000001", "too_many_decimals"],
    ["1000000.000001", "too_large"],
    ["99999999999999999999999", "too_large"],
    ["1".repeat(40), "invalid_format"],
  ])("rejects %j as %s", (input, error) => {
    expect(parseUsdcAmount(input)).toEqual({ ok: false, error });
  });
});

describe("formatUsdcUnits", () => {
  it.each([
    [BigInt(100_000_000), "100.00"],
    [BigInt(100_500_000), "100.50"],
    [BigInt(1), "0.000001"],
    [BigInt(1_234_567), "1.234567"],
    ["1000000000000", "1,000,000.00"],
  ])("formats %s as %s", (units, text) => {
    expect(formatUsdcUnits(units)).toBe(text);
  });

  it("round-trips every parsed amount", () => {
    for (const input of ["0.000001", "1.5", "100", "123456.654321"]) {
      const parsed = parseUsdcAmount(input);
      if (!parsed.ok) throw new Error(input);
      expect(parseUsdcAmount(formatUsdcUnits(parsed.units).replace(/,/g, ""))).toEqual(parsed);
    }
  });
});
