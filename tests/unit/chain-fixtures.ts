import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi, keccak256, toHex, type Hex } from "viem";

import { TEST_USDC } from "@/lib/chain/allowlist";
import type { ChainBlock, ChainReader, ChainReceipt, ChainTransaction, ChainLog } from "@/lib/chain/verify-transfer";

export const PAYER = "0x1111111111111111111111111111111111111111";
export const RECIPIENT = "0x2222222222222222222222222222222222222222";
export const OTHER = "0x3333333333333333333333333333333333333333";
export const AMOUNT = BigInt(100_000_000);
export const TX = keccak256(toHex("tx-1"));
export const MINED_AT = BigInt(1_000);
export const MINED_TIMESTAMP = BigInt(Date.UTC(2026, 9, 28, 12) / 1000);

export function blockHash(number: bigint, fork = ""): Hex {
  return keccak256(toHex(`block-${number}${fork}`));
}

export function transferCall(to: string, amount: bigint): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to as Hex, amount] });
}

export function transferLog(from: string, to: string, amount: bigint, logIndex = 0, address: string = TEST_USDC.address): ChainLog {
  return {
    address,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: from as Hex, to: to as Hex } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    logIndex,
  };
}

export type Scenario = {
  chainId: number;
  head: bigint;
  tx: ChainTransaction | null;
  receipt: ChainReceipt | null;
  /** Second receipt fetch (canonical re-check); defaults to `receipt`. */
  receiptAgain?: ChainReceipt | null;
  blocks: Map<bigint, ChainBlock>;
  /** Block returned on the second fetch of the mined block; defaults to the first. */
  blockAgain?: ChainBlock | null;
  fail?: "chainId" | "receipt" | "head";
};

export function validScenario(): Scenario {
  return {
    chainId: 84532,
    head: MINED_AT + BigInt(2), // exactly 3 confirmations
    tx: { hash: TX, from: PAYER, to: TEST_USDC.address, input: transferCall(RECIPIENT, AMOUNT), blockNumber: MINED_AT },
    receipt: {
      status: "success",
      blockNumber: MINED_AT,
      blockHash: blockHash(MINED_AT),
      logs: [transferLog(PAYER, RECIPIENT, AMOUNT, 7)],
    },
    blocks: new Map([
      [MINED_AT, { hash: blockHash(MINED_AT), number: MINED_AT, timestamp: MINED_TIMESTAMP }],
      // Head block, 30 s of chain time later (exactly the minimum age).
      [MINED_AT + BigInt(2), { hash: blockHash(MINED_AT + BigInt(2)), number: MINED_AT + BigInt(2), timestamp: MINED_TIMESTAMP + BigInt(30) }],
    ]),
  };
}

export function readerFor(scenario: Scenario): ChainReader {
  let receiptCalls = 0;
  let blockCalls = 0;
  return {
    async getChainId() {
      if (scenario.fail === "chainId") throw new Error("rpc down");
      return scenario.chainId;
    },
    async getBlockNumber() {
      if (scenario.fail === "head") throw new Error("rpc down");
      return scenario.head;
    },
    async getTransaction() {
      return scenario.tx;
    },
    async getTransactionReceipt() {
      if (scenario.fail === "receipt") throw new Error("rpc down");
      receiptCalls += 1;
      if (receiptCalls > 1 && scenario.receiptAgain !== undefined) return scenario.receiptAgain;
      return scenario.receipt;
    },
    async getBlock(number) {
      blockCalls += 1;
      if (blockCalls > 1 && scenario.blockAgain !== undefined) return scenario.blockAgain;
      return scenario.blocks.get(number) ?? null;
    },
  };
}
