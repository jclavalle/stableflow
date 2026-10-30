import { formatUsdcUnits } from "@/lib/payments/amount";
import type { QuoteView } from "@/lib/payouts/views";
import { formatBps, formatBrlMinor, formatScaledRate } from "@/lib/quotes/fx";

/** Every figure of an illustrative quote, in calculation order. */
export function QuoteBreakdown({ quote }: { quote: QuoteView }) {
  const rows: [string, string][] = [
    ["Amount received", `${formatUsdcUnits(quote.inputUnits)} test USDC (treated as ${formatUsdcUnits(quote.inputUnits)} USD for this illustration)`],
    [`Service fee (${formatBps(quote.serviceFeeBps)}, rounded up)`, `− ${formatUsdcUnits(quote.serviceFeeUnits)} USD`],
    ["Fixed payout fee", `− ${formatUsdcUnits(quote.fixedFeeUnits)} USD`],
    ["Net to convert", `${formatUsdcUnits(quote.netUnits)} USD`],
    ["Reference rate (fixed, fictional)", `${formatScaledRate(quote.referenceRateScaled, quote.fxScale)} BRL per USD`],
    ["FX spread", `${formatBps(quote.spreadBps)} below the reference rate`],
    ["Effective rate", `${formatScaledRate(quote.effectiveRateScaled, quote.fxScale)} BRL per USD`],
  ];

  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-1 gap-x-4 text-sm sm:grid-cols-[auto_1fr] sm:gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-medium">{label}</dt>
            <dd className="mb-2 sm:mb-0">{value}</dd>
          </div>
        ))}
        <dt className="font-semibold">Illustrative payout</dt>
        <dd className="mb-2 font-semibold sm:mb-0">BRL {formatBrlMinor(quote.outputMinor)} (rounded down to the cent)</dd>
        <dt className="font-medium">Taxes</dt>
        <dd className="mb-2 sm:mb-0">Not modeled — this is not a tax calculation</dd>
        <dt className="font-medium">Network gas</dt>
        <dd className="mb-2 sm:mb-0">Paid separately by the sender in test ETH; not included and not representative of mainnet costs</dd>
        <dt className="font-medium">Assumptions</dt>
        <dd className="font-mono text-xs">{quote.assumptionsVersion}</dd>
      </dl>
      <p className="text-xs opacity-80">
        Fixed fictional rates and fees for illustration only. Not a live price, a provider quote or a promise of any payout.
      </p>
    </div>
  );
}
