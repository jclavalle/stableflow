import { BASE_SEPOLIA } from "@/lib/chain/allowlist";

// Rendered by the root layout so the disclosure persists on every page,
// including error states and receipts.
export function TestnetBanner() {
  return (
    <div
      role="region"
      aria-label="Testnet disclosure"
      className="w-full border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <strong>Testnet demo.</strong> Payments use {BASE_SEPOLIA.name} test USDC, which has no
      value. Fiat payouts are simulated — no bank transfer occurs.
    </div>
  );
}
