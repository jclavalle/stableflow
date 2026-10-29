// Deterministic stand-in for a Base Sepolia JSON-RPC node, for E2E tests only.
// One block per second; transactions sent via `test_sendTransaction` are mined
// in the next block, and USDC `transfer` calls emit a Transfer event.
// Test controls: `test_setOutage` (transaction lookups fail; pass a sender to
// limit it to that payer's transactions, so parallel specs are unaffected), `test_dropTransaction`
// (the transaction vanishes, as after a reorg), `test_reset`.
import { createServer } from "node:http";

import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  keccak256,
  numberToHex,
  toHex,
} from "viem";

const PORT = Number(process.env.MOCK_RPC_PORT ?? 8546);
const CHAIN_ID = 84532;
const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const GENESIS_BLOCK = 30_000_000;
const startedAt = Date.now();
const startTimestamp = Math.floor(startedAt / 1000);

let txs = new Map();
let nonce = 0;
let outage = false;
let outageSenders = new Set();

const head = () => GENESIS_BLOCK + Math.floor((Date.now() - startedAt) / 1000);
const blockHash = (n) => keccak256(toHex(`mock-block-${n}`));
const hex = (n) => numberToHex(BigInt(n));
const ZERO32 = `0x${"0".repeat(64)}`;

function block(n, full = false) {
  if (n > head()) return null;
  const included = [...txs.values()].filter((tx) => tx.blockNumber === n);
  return {
    number: hex(n),
    hash: blockHash(n),
    parentHash: blockHash(n - 1),
    timestamp: hex(startTimestamp + (n - GENESIS_BLOCK)),
    nonce: "0x0000000000000000",
    difficulty: "0x0",
    totalDifficulty: "0x0",
    gasLimit: hex(30_000_000),
    gasUsed: hex(included.length * 50_000),
    baseFeePerGas: hex(1_000_000),
    miner: `0x${"0".repeat(40)}`,
    extraData: "0x",
    logsBloom: `0x${"0".repeat(512)}`,
    mixHash: ZERO32,
    receiptsRoot: ZERO32,
    sha3Uncles: ZERO32,
    stateRoot: ZERO32,
    transactionsRoot: ZERO32,
    size: hex(1000),
    uncles: [],
    transactions: included.map((tx) => (full ? txObject(tx) : tx.hash)),
  };
}

function txObject(tx) {
  const mined = tx.blockNumber <= head();
  return {
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    input: tx.data,
    value: "0x0",
    nonce: hex(tx.nonce),
    gas: hex(100_000),
    gasPrice: hex(1_000_000),
    maxFeePerGas: hex(2_000_000),
    maxPriorityFeePerGas: hex(1),
    type: "0x2",
    chainId: hex(CHAIN_ID),
    v: "0x0",
    r: ZERO32,
    s: ZERO32,
    yParity: "0x0",
    accessList: [],
    blockNumber: mined ? hex(tx.blockNumber) : null,
    blockHash: mined ? blockHash(tx.blockNumber) : null,
    transactionIndex: mined ? "0x0" : null,
  };
}

function receipt(tx) {
  if (tx.blockNumber > head()) return null;
  const logs = [];
  if (tx.to === USDC) {
    try {
      const call = decodeFunctionData({ abi: erc20Abi, data: tx.data });
      if (call.functionName === "transfer") {
        logs.push({
          address: USDC,
          topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: tx.from, to: call.args[0] } }),
          data: encodeAbiParameters([{ type: "uint256" }], [call.args[1]]),
          logIndex: "0x0",
          blockNumber: hex(tx.blockNumber),
          blockHash: blockHash(tx.blockNumber),
          transactionHash: tx.hash,
          transactionIndex: "0x0",
          removed: false,
        });
      }
    } catch {
      // Not ERC-20 calldata: no event.
    }
  }
  return {
    transactionHash: tx.hash,
    transactionIndex: "0x0",
    blockNumber: hex(tx.blockNumber),
    blockHash: blockHash(tx.blockNumber),
    from: tx.from,
    to: tx.to,
    status: "0x1",
    gasUsed: hex(50_000),
    cumulativeGasUsed: hex(50_000),
    effectiveGasPrice: hex(1_000_000),
    contractAddress: null,
    logs,
    logsBloom: `0x${"0".repeat(512)}`,
    type: "0x2",
  };
}

function ethCall({ to, data }) {
  if (to?.toLowerCase() !== USDC) return "0x";
  const call = decodeFunctionData({ abi: erc20Abi, data });
  if (call.functionName === "balanceOf") return encodeAbiParameters([{ type: "uint256" }], [BigInt(1_000_000) * BigInt(1_000_000)]);
  if (call.functionName === "decimals") return encodeAbiParameters([{ type: "uint8" }], [6]);
  if (call.functionName === "symbol") return encodeAbiParameters([{ type: "string" }], ["USDC"]);
  return "0x";
}

// Outage affects transaction lookups only, so tests creating requests (which
// read the head block) in parallel are not disturbed.
const CHAIN_READS = new Set(["eth_getTransactionByHash", "eth_getTransactionReceipt"]);

function inOutage(method, params) {
  if (!CHAIN_READS.has(method)) return false;
  if (outage) return true;
  const tx = txs.get(String(params[0]).toLowerCase());
  return Boolean(tx && outageSenders.has(tx.from));
}

function handle(method, params) {
  if (inOutage(method, params)) throw Object.assign(new Error("mock outage"), { code: -32603 });
  switch (method) {
    case "eth_chainId":
      return hex(CHAIN_ID);
    case "net_version":
      return String(CHAIN_ID);
    case "eth_blockNumber":
      return hex(head());
    case "eth_getBlockByNumber": {
      const tag = params[0];
      const n = tag === "latest" || tag === "pending" || tag === "safe" || tag === "finalized" ? head() : Number(BigInt(tag));
      return block(n, params[1]);
    }
    case "eth_getBlockByHash": {
      for (let n = head(); n >= GENESIS_BLOCK; n--) if (blockHash(n) === params[0]) return block(n, params[1]);
      return null;
    }
    case "eth_getTransactionByHash": {
      const tx = txs.get(params[0].toLowerCase());
      return tx ? txObject(tx) : null;
    }
    case "eth_getTransactionReceipt": {
      const tx = txs.get(params[0].toLowerCase());
      return tx ? receipt(tx) : null;
    }
    case "eth_call":
      return ethCall(params[0]);
    case "eth_getBalance":
      return hex(BigInt(10) ** BigInt(18));
    case "eth_getCode":
      return params[0].toLowerCase() === USDC ? "0x6080" : "0x";
    case "eth_getTransactionCount":
      return hex(nonce);
    case "eth_estimateGas":
      return hex(100_000);
    case "eth_gasPrice":
      return hex(1_000_000);
    case "eth_maxPriorityFeePerGas":
      return hex(1);
    case "eth_feeHistory":
      return { oldestBlock: hex(head()), baseFeePerGas: [hex(1_000_000), hex(1_000_000)], gasUsedRatio: [0.5], reward: [[hex(1)]] };
    case "test_sendTransaction": {
      const { from, to, data } = params[0];
      const hash = keccak256(toHex(`mock-tx-${nonce}-${from}-${data}-${Date.now()}`));
      txs.set(hash, { hash, from: from.toLowerCase(), to: to?.toLowerCase() ?? null, data: data ?? "0x", nonce: nonce++, blockNumber: head() + 1 });
      return hash;
    }
    case "test_dropTransaction":
      return txs.delete(String(params[0]).toLowerCase());
    case "test_setOutage": {
      const [on, sender] = params;
      if (sender) {
        if (on) outageSenders.add(String(sender).toLowerCase());
        else outageSenders.delete(String(sender).toLowerCase());
      } else {
        outage = Boolean(on);
        if (!on) outageSenders = new Set();
      }
      return Boolean(on);
    }
    case "test_reset":
      txs = new Map();
      outage = false;
      outageSenders = new Set();
      return true;
    default:
      throw Object.assign(new Error(`mock-rpc: unsupported method ${method}`), { code: -32601 });
  }
}

const server = createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS");
  if (req.method === "OPTIONS") return res.end();
  if (req.method === "GET") return res.end("mock-rpc ok");

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const answer = (call) => {
      try {
        return { jsonrpc: "2.0", id: call.id, result: handle(call.method, call.params ?? []) };
      } catch (error) {
        return { jsonrpc: "2.0", id: call.id, error: { code: error.code ?? -32603, message: error.message } };
      }
    };
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.statusCode = 400;
      return res.end();
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(Array.isArray(parsed) ? parsed.map(answer) : answer(parsed)));
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock-rpc listening on http://127.0.0.1:${PORT}`));
