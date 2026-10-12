import { formatCount, formatMoney } from '@uw/core/money';
import type { CostTotals } from '@uw/harness';

export function costText(cost: CostTotals): {
  readonly metered: string;
  readonly subscription: string;
} {
  const meteredMinor = cost.meteredMinor + cost.computeMinor;
  return {
    metered:
      meteredMinor === 0
        ? 'No metered cost'
        : formatMoney({ amountMinor: meteredMinor, currency: cost.currency }),
    subscription:
      cost.subscriptionTokens === 0
        ? 'No subscription tokens'
        : `${formatCount(cost.subscriptionTokens)} subscription tokens`,
  };
}
