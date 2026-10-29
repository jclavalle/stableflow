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

describe("verifyTransfer: smart accounts and relayers (D37)", () => {
  const RELAYER = "0x4444444444444444444444444444444444444444";
  const DELEGATION = "0x5555555555555555555555555555555555555555";

  it("confirms a relayed EIP-7702 payment, recording the token sender (as seen on Base Sepolia with MetaMask)", async () => {
    const result = await run((s) => {
      s.tx = { ...s.tx!, from: RELAYER, to: DELEGATION, input: "0xcef6d209" };
      s.receipt!.logs = [
        { address: DELEGATION, topics: [blockHash(BigInt(1))], data: "0x", logIndex: 6 },
        transferLog(PAYER, RECIPIENT, AMOUNT, 7),
      ];
    });
    expect(result).toMatchObject({ kind: "confirmed", evidence: { sender: PAYER, logIndex: 7, recipient: RECIPIENT } });
  });

  it("allows a separate USDC fee to another address in the same transaction", async () => {
    const result = await run((s) => {
      s.tx = { ...s.tx!, from: RELAYER, to: DELEGATION, input: "0xcef6d209" };
      s.receipt!.logs = [transferLog(PAYER, RELAYER, BigInt(10_000), 6), transferLog(PAYER, RECIPIENT, AMOUNT, 7)];
    });
    expect(result).toMatchObject({ kind: "confirmed", evidence: { logIndex: 7 } });
  });

  it("confirms a transferFrom sent by a third party", async () => {
    const result = await run((s) => {
      s.tx = { ...s.tx!, from: OTHER, input: "0x23b872dd" };
    });
    expect(result).toMatchObject({ kind: "confirmed", evidence: { sender: PAYER } });
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

describe("verifyTransfer: minimum confirmation age (D38)", () => {
  const head = MINED_AT + BigInt(2);
  const withHeadAge = (seconds: number) => (s: Scenario) =>
    s.blocks.set(head, { hash: blockHash(head), number: head, timestamp: MINED_TIMESTAMP + BigInt(seconds) });

  it("stays pending with enough blocks until 30 s of chain time have passed", async () => {
    await expect(run(withHeadAge(29))).resolves.toEqual({ kind: "pending", confirmations: 3, reason: "aging" });
    expect((await run(withHeadAge(30))).kind).toBe("confirmed");
  });

  it("keeps waiting even with many fast blocks", async () => {
    const result = await run((s) => {
      s.head = MINED_AT + BigInt(150);
      s.blocks.set(s.head, { hash: blockHash(s.head), number: s.head, timestamp: MINED_TIMESTAMP + BigInt(29) });
    });
    expect(result).toEqual({ kind: "pending", confirmations: 151, reason: "aging" });
  });

  it("is unavailable, never confirmed, if the head block can't be read", async () => {
    await expect(run((s) => s.blocks.delete(head))).resolves.toEqual({ kind: "unavailable", reason: "rpc_error" });
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
    ["no test-USDC Transfer event", (s) => (s.receipt!.logs = []), {}, "no_token_transfer"],
    [
      "Transfer event from a different token only",
      (s) => (s.receipt!.logs = [transferLog(PAYER, RECIPIENT, AMOUNT, 0, OTHER)]),
      {},
      "no_token_transfer",
    ],
    [
      "two Transfer events to the recipient (ambiguous)",
      (s) => s.receipt!.logs.push(transferLog(PAYER, RECIPIENT, AMOUNT, 8)),
      {},
      "unexpected_transfer_logs",
    ],
    [
      "split payment to the recipient (ambiguous)",
      (s) =>
        (s.receipt!.logs = [
          transferLog(PAYER, RECIPIENT, AMOUNT / BigInt(2), 7),
          transferLog(PAYER, RECIPIENT, AMOUNT / BigInt(2), 8),
        ]),
      {},
      "unexpected_transfer_logs",
    ],
    [
      "USDC sent to someone else",
      (s) => (s.receipt!.logs = [transferLog(PAYER, OTHER, AMOUNT, 7)]),
      {},
      "wrong_recipient",
    ],
    [
      "underpayment",
      (s) => (s.receipt!.logs = [transferLog(PAYER, RECIPIENT, AMOUNT - BigInt(1), 7)]),
      {},
      "wrong_amount",
    ],
    [
      "overpayment",
      (s) => (s.receipt!.logs = [transferLog(PAYER, RECIPIENT, AMOUNT + BigInt(1), 7)]),
      {},
      "wrong_amount",
    ],
    [
      "malformed Transfer event from the token",
      (s) => (s.receipt!.logs = [{ ...transferLog(PAYER, RECIPIENT, AMOUNT, 7), data: "0x" }]),
      {},
      "unexpected_transfer_logs",
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
