import type { CostBasis, Harness, ItemState, RunShape, Stage } from '@uw/contracts';
import type { RunRow } from '../ports.ts';

export type CostTotals = {
  readonly meteredMinor: number;
  readonly computeMinor: number;
  readonly meteredTokens: number;
  readonly subscriptionTokens: number;
  readonly currency: 'USD';
};
export type CardHost = RunShape | 'person' | null;
export type FlowStage = {
  readonly stage: Stage;
  readonly count: number;
  readonly held: number;
  readonly oldestEnteredAt: Date | null;
  readonly cost: CostTotals;
};
export type FlowView = { readonly harness: Harness; readonly stages: readonly FlowStage[] };
export type BoardCard = {
  readonly item: ItemState;
  readonly host: CardHost;
  readonly leaseExpiresAt: Date | null;
  readonly bases: readonly CostBasis[];
  readonly cost: CostTotals;
  readonly liveRun: RunRow | null;
};
export type BoardColumn = {
  readonly stage: Stage;
  readonly held: number;
  readonly cards: readonly BoardCard[];
  readonly next: string | null;
};
export type BoardView = { readonly harness: Harness; readonly columns: readonly BoardColumn[] };
export type BoardInput = {
  readonly harnessId: string;
  readonly stageKey: string | null;
  readonly after: { readonly priority: number; readonly itemId: string } | null;
};
