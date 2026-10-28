import type { Page } from "@playwright/test";

export const MOCK_RPC_URL = "http://127.0.0.1:8546";

/**
 * Installs a minimal EIP-1193 wallet as `window.ethereum`. It holds no keys:
 * transactions are handed to the mock RPC, which mines them. Starts on the
 * given chain so tests can exercise the "switch network" step.
 */
export async function installFakeWallet(page: Page, options: { account: string; chainId: number }) {
  await page.addInitScript(
    ({ account, chainId, rpcUrl }) => {
      let currentChain = chainId;
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      const emit = (event: string, ...args: unknown[]) => listeners.get(event)?.forEach((fn) => fn(...args));
      const rpc = async (method: string, params: unknown[] = []) => {
        const response = await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
        });
        const data = await response.json();
        if (data.error) throw Object.assign(new Error(data.error.message), { code: data.error.code });
        return data.result;
      };

      const provider = {
        isFakeWallet: true,
        async request({ method, params }: { method: string; params?: unknown[] }) {
          switch (method) {
            case "eth_requestAccounts":
            case "eth_accounts":
              return [account];
            case "eth_chainId":
              return `0x${currentChain.toString(16)}`;
            case "wallet_switchEthereumChain": {
              const next = parseInt((params?.[0] as { chainId: string }).chainId, 16);
              currentChain = next;
              emit("chainChanged", `0x${next.toString(16)}`);
              return null;
            }
            case "wallet_requestPermissions":
            case "wallet_revokePermissions":
              return [{ parentCapability: "eth_accounts" }];
            case "eth_sendTransaction": {
              if (currentChain !== 84532) throw Object.assign(new Error("wrong chain"), { code: 4901 });
              return rpc("test_sendTransaction", params);
            }
            default:
              return rpc(method, params);
          }
        },
        on(event: string, fn: (...args: unknown[]) => void) {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)!.add(fn);
        },
        removeListener(event: string, fn: (...args: unknown[]) => void) {
          listeners.get(event)?.delete(fn);
        },
      };
      Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    },
    { ...options, rpcUrl: MOCK_RPC_URL },
  );
}

export async function mockRpc(method: string, params: unknown[] = []) {
  const response = await fetch(MOCK_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await response.json()).result;
}
