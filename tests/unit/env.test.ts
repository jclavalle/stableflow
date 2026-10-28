import { describe, expect, it } from "vitest";

import { parseServerEnv } from "@/lib/config/env";

const valid = {
  APP_URL: "http://localhost:3000",
  FIAT_PAYOUT_MODE: "simulation",
};

describe("parseServerEnv", () => {
  it("accepts a minimal local configuration and defaults the RPC", () => {
    expect(parseServerEnv(valid)).toEqual({
      APP_URL: "http://localhost:3000",
      BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
      FIAT_PAYOUT_MODE: "simulation",
    });
  });

  it("fails closed when fiat payout mode is missing or not simulation", () => {
    expect(() => parseServerEnv({ APP_URL: valid.APP_URL })).toThrow(/FIAT_PAYOUT_MODE/);
    expect(() => parseServerEnv({ ...valid, FIAT_PAYOUT_MODE: "live" })).toThrow(
      /FIAT_PAYOUT_MODE/,
    );
  });

  it("rejects plain-http URLs outside localhost", () => {
    expect(() => parseServerEnv({ ...valid, APP_URL: "http://stableflow.example" })).toThrow(
      /APP_URL/,
    );
    expect(() =>
      parseServerEnv({ ...valid, BASE_SEPOLIA_RPC_URL: "http://rpc.example" }),
    ).toThrow(/BASE_SEPOLIA_RPC_URL/);
  });

  it("rejects malformed URLs", () => {
    expect(() => parseServerEnv({ ...valid, APP_URL: "not a url" })).toThrow(/APP_URL/);
  });

  it("refuses secret-looking NEXT_PUBLIC_ variables", () => {
    expect(() =>
      parseServerEnv({ ...valid, NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "x" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/);
    expect(() => parseServerEnv({ ...valid, NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL: "x" })).toThrow(
      /exposed to the browser/,
    );
  });

  it("allows public non-secret variables", () => {
    expect(() =>
      parseServerEnv({ ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: "public" }),
    ).not.toThrow();
  });
});
