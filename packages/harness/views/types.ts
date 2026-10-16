import type {
  CostBasis,
  Engine,
  EvidenceLabel,
  Harness,
  HarnessEvent,
  IntakeVia,
  IssueRef,
  ItemState,
  RunShape,
  Stage,
} from '@uw/contracts';
import type { Delegation, RunRow } from '../ports.ts';
import type { RefuteTally } from './refutes.ts';

type KeyedRefuteTally = RefuteTally & { readonly harnessKey: string };

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
export type FlowView = {
  readonly harness: Harness;
  readonly stages: readonly FlowStage[];
  readonly capped: boolean;
};
export type HarnessCursor = { readonly harnessId: string; readonly cursor: number };
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
export type EpicNode = {
  readonly itemId: string;
  readonly title: string;
  readonly issue: IssueRef | null;
  readonly stageKey: string;
  readonly position: number;
  readonly blockedBy: readonly string[];
  readonly waiting: boolean;
  readonly passedShip: boolean;
};
export type EpicGroup = {
  readonly epic: IssueRef;
  readonly title: string;
  readonly nodes: readonly EpicNode[];
};
export type NotReady = {
  readonly via: IntakeVia;
  readonly issue: IssueRef | null;
  readonly pageId: string | null;
  readonly title: string;
  readonly at: Date;
};
export type BoardView = {
  readonly harness: Harness;
  readonly columns: readonly BoardColumn[];
  readonly epics: readonly EpicGroup[];
  readonly notReady: readonly NotReady[];
};
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
export type GateList = { readonly rows: readonly GateRow[]; readonly capped: boolean };
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
    }
  | {
      readonly kind: 'handed_to_person';
      readonly harness: Harness;
      readonly item: ItemState;
      readonly rounds: number | null;
    };
export type Waiting = {
  readonly rows: readonly WaitingRow[];
  readonly failedRunsCapped: boolean;
  readonly gatesCapped: boolean;
  readonly lapsedCapped: boolean;
  readonly handedCapped: boolean;
};
export type DecideAbility =
  | { readonly can: true }
  | {
      readonly can: false;
      readonly reason: 'not_permitted' | 'item_not_at_gate' | 'approver_lacks_domain_grant';
    };
export type PlayByPlay = {
  readonly harness: Harness;
  readonly stage: Stage;
  readonly item: ItemState;
  readonly events: readonly HarnessEvent[];
  readonly next: number | null;
  readonly learnings: Readonly<Record<string, EvidenceLabel>>;
  readonly personaPages: Readonly<Record<string, string>>;
};
export const FAILED_RUNS_LIMIT = 50;
export const VIEW_LIMIT = 5000;
export const WAITING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const PLAY_PAGE = 100;
export type PlaneTotals = {
  readonly at: Date;
  readonly spend: {
    readonly meteredMinor: number;
    readonly computeMinor: number;
    readonly subscriptionTokens: number;
    readonly currency: 'USD';
    readonly since: Date;
  };
  readonly runsToday: {
    readonly byShape: Readonly<Record<RunShape, number>>;
    readonly byEngine: Readonly<Partial<Record<Engine, number>>>;
    readonly since: Date;
  };
  readonly liveDelegations: {
    readonly count: number;
    readonly merge: number;
    readonly soonestExpiry: Date | null;
  };
  readonly gateRefusals: {
    readonly byReason: Readonly<Record<string, number>>;
    readonly capped: boolean;
  };
  readonly agentWrites: { readonly count: number; readonly capped: boolean };
  readonly staleLearnings: { readonly count: number; readonly capped: boolean };
  readonly reviewerRefutes: {
    readonly tallies: readonly KeyedRefuteTally[];
    readonly capped: boolean;
  };
};
export type PlaneIndicator =
  | 'spend'
  | 'runs_today'
  | 'live_delegations'
  | 'gate_refusals_week'
  | 'agent_writes'
  | 'stale_learnings'
  | 'reviewer_refutes';
export type PlaneRow = {
  readonly harnessId: string | null;
  readonly cells: Readonly<Record<string, string | number | null>>;
};
export const PLANE_LIMIT = 5000;
