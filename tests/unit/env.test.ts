import { describe, expect, it } from "vitest";

import { parseServerEnv } from "@/lib/config/env";

const valid = {
  APP_URL: "http://localhost:3000",
  FIAT_PAYOUT_MODE: "simulation",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "server-only-key",
};

function without(key: keyof typeof valid): Record<string, string> {
  return Object.fromEntries(Object.entries(valid).filter(([name]) => name !== key));
}

describe("parseServerEnv", () => {
  it("accepts a minimal local configuration and defaults the RPC", () => {
    expect(parseServerEnv(valid)).toEqual({
      ...valid,
      BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
    });
  });

  it("fails closed when fiat payout mode is missing or not simulation", () => {
    expect(() => parseServerEnv(without("FIAT_PAYOUT_MODE"))).toThrow(/FIAT_PAYOUT_MODE/);
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

  it("allows a local RPC only for a local app", () => {
    expect(() =>
      parseServerEnv({ ...valid, BASE_SEPOLIA_RPC_URL: "http://127.0.0.1:8546" }),
    ).not.toThrow();
    expect(() =>
      parseServerEnv({
        ...valid,
        APP_URL: "https://stableflow.example",
        BASE_SEPOLIA_RPC_URL: "http://127.0.0.1:8546",
      }),
    ).toThrow(/must not be local/);
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

  it("requires the server-only Supabase key", () => {
    expect(() => parseServerEnv(without("SUPABASE_SERVICE_ROLE_KEY"))).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("allows public non-secret variables", () => {
    expect(() =>
      parseServerEnv({ ...valid, NEXT_PUBLIC_SUPABASE_ANON_KEY: "public" }),
    ).not.toThrow();
  });
});
