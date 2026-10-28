import { describe, expect, it } from "vitest";

import { verifyTransfer, type TransferExpectation } from "@/lib/chain/verify-transfer";

import {
  AMOUNT,
  blockHash,
  MINED_AT,
  MINED_TIMESTAMP,
  OTHER,
  PAYER,
  readerFor,
  RECIPIENT,
  transferCall,
  transferLog,
  TX,
  validScenario,
  type Scenario,
} from "./chain-fixtures";

const expected: TransferExpectation = {
  recipient: RECIPIENT,
  amountUnits: AMOUNT,
  creationBlock: MINED_AT - BigInt(10),
  expiresAt: new Date(Number(MINED_TIMESTAMP) * 1000 + 60_000),
};

function run(change: (s: Scenario) => void = () => {}, overrides: Partial<TransferExpectation> = {}, hash: string = TX) {
  const scenario = validScenario();
  change(scenario);
  return verifyTransfer(readerFor(scenario), hash, { ...expected, ...overrides });
}

describe("verifyTransfer: valid receipt", () => {
  it("confirms a direct exact transfer with three confirmations", async () => {
    await expect(run()).resolves.toEqual({
      kind: "confirmed",
      evidence: {
        txHash: TX,
        logIndex: 7,
        blockNumber: MINED_AT,
        blockHash: blockHash(MINED_AT),
        blockTimestamp: new Date(Number(MINED_TIMESTAMP) * 1000),
        sender: PAYER,
        recipient: RECIPIENT,
        amountUnits: AMOUNT,
        confirmations: 3,
      },
    });
  });

  it("accepts mixed-case hashes and addresses", async () => {
    const result = await run((s) => {
      s.tx!.from = PAYER.toUpperCase().replace("0X", "0x");
    }, { recipient: RECIPIENT.toUpperCase().replace("0X", "0x") }, TX.toUpperCase().replace("0X", "0x"));
    expect(result.kind).toBe("confirmed");
  });

  it("ignores unrelated logs from other contracts", async () => {
    const result = await run((s) => {
      s.receipt!.logs.unshift(transferLog(PAYER, RECIPIENT, AMOUNT, 1, OTHER));
    });
    expect(result.kind).toBe("confirmed");
  });
});

describe("verifyTransfer: confirmations boundary", () => {
  it("is pending at two confirmations and confirmed at three", async () => {
    await expect(run((s) => (s.head = MINED_AT + BigInt(1)))).resolves.toEqual({
      kind: "pending",
      confirmations: 2,
      reason: "confirming",
    });
    expect((await run((s) => (s.head = MINED_AT + BigInt(2)))).kind).toBe("confirmed");
  });

  it("reports zero confirmations if the RPC head lags the receipt", async () => {
    await expect(run((s) => (s.head = MINED_AT - BigInt(1)))).resolves.toMatchObject({
      kind: "pending",
      confirmations: 0,
    });
  });
});

describe("verifyTransfer: not yet on chain", () => {
  it("is submitted when the transaction is unknown", async () => {
    await expect(run((s) => (s.tx = null))).resolves.toEqual({ kind: "submitted", reason: "not_found" });
  });

  it("is submitted when the transaction has no receipt yet", async () => {
    await expect(run((s) => (s.receipt = null))).resolves.toEqual({ kind: "submitted", reason: "not_mined" });
  });
});

describe("verifyTransfer: negative fixtures are rejected", () => {
  const cases: [string, (s: Scenario) => void, Partial<TransferExpectation>, string][] = [
    ["reverted receipt", (s) => (s.receipt!.status = "reverted"), {}, "reverted"],
    ["request without a creation block", () => {}, { creationBlock: null }, "request_missing_creation_block"],
    ["transaction to another token contract", (s) => (s.tx!.to = OTHER), {}, "wrong_token_contract"],
    ["contract creation (no to)", (s) => (s.tx!.to = null), {}, "wrong_token_contract"],
    [
      "transferFrom instead of transfer",
      (s) => {
        s.tx!.input = "0x23b872dd" + s.tx!.input.slice(10) + "0".repeat(64) as `0x${string}`;
      },
      {},
      "not_direct_transfer",
    ],
    ["garbage calldata", (s) => (s.tx!.input = "0xdeadbeef"), {}, "not_direct_transfer"],
    ["calldata to the wrong recipient", (s) => (s.tx!.input = transferCall(OTHER, AMOUNT)), {}, "wrong_recipient"],
    ["underpayment", (s) => (s.tx!.input = transferCall(RECIPIENT, AMOUNT - BigInt(1))), {}, "wrong_amount"],
    ["overpayment", (s) => (s.tx!.input = transferCall(RECIPIENT, AMOUNT + BigInt(1))), {}, "wrong_amount"],
    ["no Transfer event", (s) => (s.receipt!.logs = []), {}, "unexpected_transfer_logs"],
    [
      "Transfer event from a different contract only",
      (s) => (s.receipt!.logs = [transferLog(PAYER, RECIPIENT, AMOUNT, 0, OTHER)]),
      {},
      "unexpected_transfer_logs",
    ],
    [
      "two Transfer events (ambiguous)",
      (s) => s.receipt!.logs.push(transferLog(PAYER, RECIPIENT, AMOUNT, 8)),
      {},
      "unexpected_transfer_logs",
    ],
    [
      "event sender differs from transaction sender",
      (s) => (s.receipt!.logs = [transferLog(OTHER, RECIPIENT, AMOUNT, 7)]),
      {},
      "sender_mismatch",
    ],
    [
      "event recipient differs from calldata",
      (s) => (s.receipt!.logs = [transferLog(PAYER, OTHER, AMOUNT, 7)]),
      {},
      "wrong_recipient",
    ],
    [
      "event amount differs from calldata",
      (s) => (s.receipt!.logs = [transferLog(PAYER, RECIPIENT, AMOUNT - BigInt(1), 7)]),
      {},
      "wrong_amount",
    ],
    ["transfer mined before the request existed", () => {}, { creationBlock: MINED_AT + BigInt(1) }, "transfer_before_request"],
    [
      "transfer mined at the expiry instant",
      () => {},
      { expiresAt: new Date(Number(MINED_TIMESTAMP) * 1000) },
      "transfer_after_expiry",
    ],
  ];

  it.each(cases)("%s", async (_name, change, overrides, code) => {
    await expect(run(change, overrides)).resolves.toEqual({ kind: "rejected", code });
  });

  it.each(["0x1234", "not-a-hash", `0x${"g".repeat(64)}`, ""])("malformed hash %j", async (hash) => {
    await expect(run(() => {}, {}, hash)).resolves.toEqual({ kind: "rejected", code: "invalid_hash" });
  });

  it("accepts the creation block itself as the earliest valid block", async () => {
    expect((await run(() => {}, { creationBlock: MINED_AT })).kind).toBe("confirmed");
  });
});

describe("verifyTransfer: chain and RPC failures never confirm", () => {
  it("is unavailable when the RPC reports a different chain", async () => {
    await expect(run((s) => (s.chainId = 8453))).resolves.toEqual({ kind: "unavailable", reason: "rpc_wrong_chain" });
  });

  it.each(["chainId", "receipt", "head"] as const)("is unavailable when %s lookup throws", async (fail) => {
    await expect(run((s) => (s.fail = fail))).resolves.toEqual({ kind: "unavailable", reason: "rpc_error" });
  });

  it("is unavailable when the mined block cannot be fetched", async () => {
    await expect(run((s) => s.blocks.clear())).resolves.toEqual({ kind: "unavailable", reason: "rpc_error" });
  });
});

describe("verifyTransfer: reorganisation", () => {
  it("stays pending when the canonical block hash differs from the receipt", async () => {
    await expect(
      run((s) => s.blocks.set(MINED_AT, { hash: blockHash(MINED_AT, "fork"), number: MINED_AT, timestamp: MINED_TIMESTAMP })),
    ).resolves.toEqual({ kind: "pending", confirmations: 0, reason: "block_not_canonical" });
  });

  it("stays pending when the receipt moves between the two fetches", async () => {
    await expect(
      run((s) => (s.receiptAgain = { ...s.receipt!, blockHash: blockHash(MINED_AT, "fork") })),
    ).resolves.toEqual({ kind: "pending", confirmations: 0, reason: "block_not_canonical" });
  });

  it("stays pending when the receipt disappears on re-check (dropped by reorg)", async () => {
    await expect(run((s) => (s.receiptAgain = null))).resolves.toMatchObject({ kind: "pending", reason: "block_not_canonical" });
  });

  it("stays pending when the block changes on re-check", async () => {
    await expect(
      run((s) => (s.blockAgain = { hash: blockHash(MINED_AT, "fork"), number: MINED_AT, timestamp: MINED_TIMESTAMP })),
    ).resolves.toMatchObject({ kind: "pending", reason: "block_not_canonical" });
  });
});
