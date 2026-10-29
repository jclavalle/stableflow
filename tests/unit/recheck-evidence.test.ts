import { describe, expect, it } from "vitest";

import { recheckEvidence, type StoredEvidence } from "@/lib/chain/recheck-evidence";

import { AMOUNT, blockHash, MINED_AT, OTHER, PAYER, readerFor, RECIPIENT, transferLog, TX, validScenario, type Scenario } from "./chain-fixtures";

const stored: StoredEvidence = {
  txHash: TX,
  logIndex: 7,
  blockNumber: MINED_AT,
  blockHash: blockHash(MINED_AT),
  recipient: RECIPIENT,
  amountUnits: AMOUNT,
};

function run(change: (s: Scenario) => void = () => {}, evidence: Partial<StoredEvidence> = {}) {
  const scenario = validScenario();
  change(scenario);
  return recheckEvidence(readerFor(scenario), { ...stored, ...evidence });
}

describe("recheckEvidence", () => {
  it("accepts evidence that is still on the canonical chain", async () => {
    await expect(run()).resolves.toEqual({ kind: "valid" });
  });

  it("flags a receipt that disappeared (dropped by a reorg)", async () => {
    await expect(run((s) => (s.receipt = null))).resolves.toEqual({ kind: "invalid", reason: "receipt_missing" });
  });

  it("flags a transaction re-mined in a different block", async () => {
    await expect(
      run((s) => {
        s.receipt = { ...s.receipt!, blockNumber: MINED_AT + BigInt(1), blockHash: blockHash(MINED_AT + BigInt(1)) };
      }),
    ).resolves.toEqual({ kind: "invalid", reason: "block_changed" });
  });

  it("flags a block replaced at the same height", async () => {
    await expect(
      run((s) => s.blocks.set(MINED_AT, { hash: blockHash(MINED_AT, "fork"), number: MINED_AT, timestamp: BigInt(1) })),
    ).resolves.toEqual({ kind: "invalid", reason: "block_not_canonical" });
  });

  it("flags a reverted receipt", async () => {
    await expect(run((s) => (s.receipt = { ...s.receipt!, status: "reverted" }))).resolves.toEqual({
      kind: "invalid",
      reason: "receipt_reverted",
    });
  });

  it.each([
    ["log removed", (s: Scenario) => (s.receipt = { ...s.receipt!, logs: [] })],
    ["different recipient", (s: Scenario) => (s.receipt = { ...s.receipt!, logs: [transferLog(PAYER, OTHER, AMOUNT, 7)] })],
    ["different amount", (s: Scenario) => (s.receipt = { ...s.receipt!, logs: [transferLog(PAYER, RECIPIENT, AMOUNT - BigInt(1), 7)] })],
    ["other token", (s: Scenario) => (s.receipt = { ...s.receipt!, logs: [transferLog(PAYER, RECIPIENT, AMOUNT, 7, OTHER)] })],
  ])("flags the stored log when %s", async (_name, change) => {
    await expect(run(change)).resolves.toEqual({ kind: "invalid", reason: "log_missing" });
  });

  it.each([
    ["RPC error", (s: Scenario) => (s.fail = "receipt")],
    ["wrong chain", (s: Scenario) => (s.chainId = 1)],
    ["block not returned", (s: Scenario) => s.blocks.clear()],
  ])("is unavailable (never valid) on %s", async (_name, change) => {
    await expect(run(change)).resolves.toEqual({ kind: "unavailable" });
  });
});
