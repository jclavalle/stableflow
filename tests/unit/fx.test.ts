import { describe, expect, it } from "vitest";

import { computeQuote, formatBps, formatBrlMinor, formatScaledRate, QUOTE_ASSUMPTIONS } from "@/lib/quotes/fx";

const usdc = (whole: number) => BigInt(whole) * BigInt(1_000_000);

describe("computeQuote", () => {
  it("matches the documented example: 100 test USDC → BRL 490.05", () => {
    const result = computeQuote(usdc(100));
    expect(result).toEqual({
      ok: true,
      figures: {
        inputUnits: usdc(100),
        serviceFeeBps: BigInt(50),
        serviceFeeUnits: BigInt(500_000), // 0.50
        fixedFeeUnits: BigInt(500_000), // 0.50
        netUnits: BigInt(99_000_000), // 99.00
        fxScale: BigInt(10_000),
        referenceRateScaled: BigInt(50_000), // 5.00
        spreadBps: BigInt(100),
        effectiveRateScaled: BigInt(49_500), // 4.95
        outputMinor: BigInt(49_005), // 490.05
      },
    });
  });

  it("rounds the service fee up to the next USDC base unit", () => {
    // 1.000001 USDC * 0.5% = 0.005000005 → 5001 units, not 5000.
    const result = computeQuote(BigInt(1_000_001));
    expect(result.ok && result.figures.serviceFeeUnits).toBe(BigInt(5_001));
  });

  it("rounds the BRL output down to the cent", () => {
    // 1 USDC: net 0.495 USD * 4.95 = 2.45025 BRL → 2.45.
    const result = computeQuote(usdc(1));
    expect(result.ok && result.figures.netUnits).toBe(BigInt(495_000));
    expect(result.ok && result.figures.outputMinor).toBe(BigInt(245));
  });

  it("stays exact at the request cap without floating point", () => {
    const result = computeQuote(usdc(1_000_000));
    // fee 5000 + 0.50; net 994,999.50 USD * 4.95 = 4,925,247.525 → 4,925,247.52
    expect(result.ok && result.figures.outputMinor).toBe(BigInt(492_524_752));
  });

  it.each([
    [BigInt(0), "invalid_input"],
    [BigInt(-1), "invalid_input"],
    [BigInt(500_000), "fees_exceed_amount"], // 0.50: fees alone are 0.5025
    [BigInt(502_513), "fees_exceed_amount"], // fee ceil(2512.565)=2513 + 500000 = exactly the input
    [BigInt(502_514), "payout_too_small"], // net 1 unit → 0.00000495 BRL
  ])("refuses %s units with %s, never a clamped payout", (units, error) => {
    expect(computeQuote(units)).toEqual({ ok: false, error });
  });

  it("produces the smallest positive payout once net value reaches a cent", () => {
    // net 2021 units * 4.95 = 0.01000395 BRL → 1 cent.
    const fee = (units: bigint) => (units * BigInt(50) + BigInt(9_999)) / BigInt(10_000);
    let input = BigInt(502_514);
    while (input - fee(input) - BigInt(500_000) < BigInt(2_021)) input += BigInt(1);
    const result = computeQuote(input);
    expect(result.ok && result.figures.outputMinor).toBe(BigInt(1));
  });

  it("uses a versioned set of assumptions", () => {
    expect(QUOTE_ASSUMPTIONS.version).toMatch(/^[a-z0-9.-]{3,64}$/);
    expect(QUOTE_ASSUMPTIONS.validitySeconds).toBe(300);
  });
});

describe("formatting", () => {
  it.each([
    [BigInt(49_005), "490.05"],
    [BigInt(5), "0.05"],
    [BigInt(0), "0.00"],
    [BigInt(492_524_752), "4,925,247.52"],
    ["100", "1.00"],
  ])("formats %s cents as BRL %s", (minor, text) => {
    expect(formatBrlMinor(minor)).toBe(text);
  });

  it("formats scaled rates and basis points", () => {
    expect(formatScaledRate(50_000, 10_000)).toBe("5.00");
    expect(formatScaledRate(49_500, 10_000)).toBe("4.95");
    expect(formatScaledRate(49_512, 10_000)).toBe("4.9512");
    expect(formatBps(50)).toBe("0.5%");
    expect(formatBps(100)).toBe("1%");
    expect(formatBps(125)).toBe("1.25%");
  });
});
