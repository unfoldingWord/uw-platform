import type {
  CostBasis,
  EvidenceLabel,
  Harness,
  HarnessEvent,
  ItemState,
  RunShape,
  Stage,
} from '@uw/contracts';
import type { Delegation, RunRow } from '../ports.ts';

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
export type GateRow = {
  readonly harness: Harness;
  readonly stage: Stage;
  readonly item: ItemState;
};
export type WaitingRow =
  | { readonly kind: 'gate'; readonly gate: GateRow }
  | {
      readonly kind: 'delegation_lapsed';
      readonly harness: Harness;
      readonly delegation: Delegation;
    }
  | {
      readonly kind: 'run_failed';
      readonly harness: Harness;
      readonly item: ItemState;
      readonly run: RunRow;
    };
export type DecideAbility =
  | { readonly can: true }
  | { readonly can: false; readonly reason: 'not_permitted' | 'approver_lacks_domain_grant' };
export type PlayByPlay = {
  readonly harness: Harness;
  readonly stage: Stage;
  readonly item: ItemState;
  readonly events: readonly HarnessEvent[];
  readonly next: number | null;
  readonly learnings: Readonly<Record<string, EvidenceLabel>>;
};
export const WAITING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const PLAY_PAGE = 100;
