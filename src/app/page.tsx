import { BASE_SEPOLIA, TEST_USDC } from "@/lib/chain/allowlist";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">StableFlow</h1>
      <p className="text-lg leading-relaxed">
        A prototype of how a freelancer in Latin America could request an international payment
        in {TEST_USDC.symbol}, see it verified on-chain, and understand what a local-currency
        payout might look like after fees.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="font-medium">Network</dt>
        <dd>
          {BASE_SEPOLIA.name} (chain ID {BASE_SEPOLIA.chainId}) — testnet only
        </dd>
        <dt className="font-medium">Token</dt>
        <dd>Test {TEST_USDC.symbol}, no financial value</dd>
        <dt className="font-medium">Fiat payout</dt>
        <dd>Simulated with fictional BRL rates and fees</dd>
      </dl>
      <p className="text-sm opacity-80">
        Status: foundation only. Sign-in, payment requests, verification and payout simulation
        are not built yet.
      </p>
    </main>
  );
}
