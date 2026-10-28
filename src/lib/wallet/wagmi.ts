import { http, createConfig } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors/injected";

// Client-side wallet connection only. The browser's RPC is never trusted as
// payment evidence; the server verifies against its own configured RPC.
export const wagmiConfig = createConfig({
  chains: [baseSepolia],
  connectors: [injected()],
  transports: { [baseSepolia.id]: http() },
  ssr: true,
});
