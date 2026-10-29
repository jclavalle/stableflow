import { createConfig, fallback, http, unstable_connector } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors/injected";

// Client-side wallet connection only. The browser's RPC is never trusted as
// payment evidence; the server verifies against its own configured RPC.
// Reads go through the connected wallet first, then the public endpoint.
export const wagmiConfig = createConfig({
  chains: [baseSepolia],
  connectors: [injected()],
  transports: { [baseSepolia.id]: fallback([unstable_connector(injected), http()]) },
  ssr: true,
});
