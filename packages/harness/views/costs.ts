import { costBasisSchema, type CostBasis, type ItemState } from '@uw/contracts';
import { bareAgent } from '../access.ts';
import type { ItemCost, RunRow } from '../ports.ts';
import type { CardHost, CostTotals } from './types.ts';

export const ZERO_COST: CostTotals = {
  meteredMinor: 0,
  computeMinor: 0,
  meteredTokens: 0,
  subscriptionTokens: 0,
  currency: 'USD',
};

function tokensOf(run: RunRow): number {
  return run.steps.reduce((sum, step) => sum + step.tokensIn + step.tokensOut, 0);
}

function withRun(total: CostTotals, run: RunRow): CostTotals {
  if (run.costBasis === 'subscription') {
    return { ...total, subscriptionTokens: total.subscriptionTokens + tokensOf(run) };
  }
  return {
    ...total,
    meteredMinor: total.meteredMinor + (run.costMinor ?? 0),
    computeMinor: total.computeMinor + (run.computeMinor ?? 0),
    meteredTokens: total.meteredTokens + tokensOf(run),
  };
}

export function costOf(runs: readonly RunRow[]): CostTotals {
  return runs.reduce(withRun, ZERO_COST);
}

function withItem(total: CostTotals, item: ItemCost): CostTotals {
  return {
    ...total,
    meteredMinor: total.meteredMinor + item.meteredMinor,
    computeMinor: total.computeMinor + item.computeMinor,
    meteredTokens: total.meteredTokens + item.meteredTokens,
    subscriptionTokens: total.subscriptionTokens + item.subscriptionTokens,
  };
}

export function costOfItems(items: readonly ItemCost[]): CostTotals {
  return items.reduce(withItem, ZERO_COST);
}

export function basesOf(runs: readonly RunRow[]): readonly CostBasis[] {
  const used = new Set(runs.map((run) => run.costBasis));
  return costBasisSchema.options.filter((basis) => used.has(basis));
}

export function hostOf(item: ItemState, liveRun: RunRow | null): CardHost {
  if (liveRun !== null) return liveRun.runShape;
  const { holder } = item;
  if (holder === null) return null;
  if (holder.startsWith('human:')) return 'person';
  return bareAgent(holder) ? 'workflow-run' : 'external-run';
}
