import { describe, expect, it } from "vitest";

import { BASE_SEPOLIA, TEST_USDC } from "@/lib/chain/allowlist";

describe("chain allowlist", () => {
  it("is pinned to Base Sepolia, never mainnet", () => {
    expect(BASE_SEPOLIA.chainId).toBe(84532);
    expect(BASE_SEPOLIA.chainId).not.toBe(8453);
  });

  it("pins test USDC with six decimals and a well-formed address", () => {
    expect(TEST_USDC.decimals).toBe(6);
    expect(TEST_USDC.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
