import type {
  CapabilityWord,
  CostBasis,
  Engine,
  BreakerLevel,
  GateDecision,
  Harness,
  HarnessEvent,
  Identity,
  ItemState,
  NewHarnessEvent,
  PageStatus,
  PageType,
  PrincipalKind,
  RunFailure,
  RunHibernation,
  RunOutcome,
  RunShape,
  RunStepRecord,
  Stage,
} from '@uw/contracts';

export type ItemClaim = {
  readonly itemId: string;
  readonly holder: Identity;
  readonly claimantKind: PrincipalKind;
  readonly delegationId: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly at: Date;
};
export type PageFacts = {
  readonly id: string;
  readonly type: PageType;
  readonly status: PageStatus;
  readonly jdArea: string;
  readonly title: string;
  readonly bodyMd: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly version: number;
};
export type StagePosition = { readonly id: string; readonly position: number };
export type StageCursor = { readonly priority: number; readonly itemId: string };
export type StagePage = { readonly after: StageCursor | null; readonly limit: number };

export type HarnessesGateway = {
  readonly read: {
    byId(harnessId: string): Promise<Harness | null>;
    byKey(key: string): Promise<Harness | null>;
    byRepository(repository: string): Promise<Harness | null>;
    list(): Promise<readonly Harness[]>;
  };
  readonly write: {
    insert(harness: Harness, at: Date): Promise<void>;
    setPaused(harnessId: string, paused: boolean): Promise<boolean>;
    setHostedBuilder(harnessId: string, enabled: boolean): Promise<boolean>;
  };
};
export type HarnessStagesGateway = {
  readonly read: {
    forHarness(harnessId: string): Promise<readonly Stage[]>;
    namesInstructions(pageId: string): Promise<boolean>;
  };
  readonly write: {
    insert(stage: Stage): Promise<void>;
    update(stage: Stage): Promise<boolean>;
    reposition(harnessId: string, positions: readonly StagePosition[]): Promise<void>;
    remove(stageId: string): Promise<boolean>;
  };
};
export type HarnessItemsGateway = {
  readonly read: {
    byId(itemId: string): Promise<ItemState | null>;
    byIssue(githubId: number): Promise<ItemState | null>;
    lock(itemId: string): Promise<ItemState | null>;
    forHarness(harnessId: string): Promise<readonly ItemState[]>;
    heldInStage(harnessId: string, stageKey: string, at: Date): Promise<number>;
    openInStage(
      harnessId: string,
      stageKey: string,
      page: StagePage,
    ): Promise<readonly ItemState[]>;
    lowestOpenPriority(harnessId: string, stageKey: string): Promise<number | null>;
    lapsedLeases(at: Date, limit: number): Promise<readonly string[]>;
  };
  readonly write: {
    insert(item: ItemState, at: Date): Promise<void>;
    claim(claim: ItemClaim): Promise<boolean>;
    project(item: ItemState): Promise<void>;
  };
};
export type PagesGateway = {
  readonly read: {
    facts(pageIds: readonly string[]): Promise<readonly PageFacts[]>;
    activePersona(identity: Identity, harnessId: string): Promise<PageFacts | null>;
  };
};
export type BreakerEventName = `breaker_${BreakerLevel}`;
export type EventQuery = {
  readonly harnessId: string;
  readonly itemId: string | null;
  readonly after: number;
  readonly limit: number;
};
export type EventPage = { readonly events: readonly HarnessEvent[]; readonly next: number | null };
export type HarnessEventsGateway = {
  readonly read: {
    page(query: EventQuery): Promise<EventPage>;
    createdFor(actor: string, requestId: string): Promise<string | null>;
    latestNamed(
      names: readonly BreakerEventName[],
      harnessId: string | null,
    ): Promise<HarnessEvent | null>;
  };
  readonly write: { append(events: readonly NewHarnessEvent[]): Promise<readonly HarnessEvent[]> };
};

export type Delegation = {
  readonly id: string;
  readonly personId: string;
  readonly persona: Identity;
  readonly harnessId: string;
  readonly capability: CapabilityWord;
  readonly grantedAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly lapsedAt: Date | null;
  readonly supersedes: string | null;
};
export type DelegationFilter = {
  readonly personId: string | null;
  readonly persona: string | null;
  readonly harnessId: string | null;
};
export type DelegationsGateway = {
  readonly read: {
    byId(delegationId: string): Promise<Delegation | null>;
    live(filter: DelegationFilter, at: Date): Promise<readonly Delegation[]>;
  };
  readonly write: {
    insert(delegation: Delegation, traceId: string): Promise<void>;
    revoke(delegationId: string, at: Date): Promise<boolean>;
    markLapsed(delegationId: string, at: Date): Promise<boolean>;
  };
};

export type GateDecisionRow = {
  readonly id: string;
  readonly harnessId: string;
  readonly itemId: string;
  readonly stageId: string;
  readonly actor: Identity;
  readonly decision: GateDecision;
  readonly reason: string | null;
  readonly evidence: HarnessEvent['evidence'];
  readonly traceId: string;
  readonly decidedAt: Date;
};
export type GateDecisionsGateway = {
  readonly read: {
    forItem(itemId: string): Promise<readonly GateDecisionRow[]>;
    anyForStage(stageId: string): Promise<boolean>;
  };
  readonly write: { insert(decision: GateDecisionRow): Promise<void> };
};

export type RunRow = {
  readonly id: string;
  readonly harnessId: string;
  readonly itemId: string;
  readonly persona: Identity;
  readonly personaPageId: string | null;
  readonly delegationId: string | null;
  readonly runShape: RunShape;
  readonly engine: Engine;
  readonly model: string;
  readonly pinnedProvider: string | null;
  readonly resolvedProvider: string | null;
  readonly steps: readonly RunStepRecord[];
  readonly costMinor: number | null;
  readonly computeMinor: number | null;
  readonly costBasis: CostBasis;
  readonly traceId: string;
  readonly outcome: RunOutcome;
  readonly hibernatedFor: RunHibernation | null;
  readonly failure: RunFailure | null;
  readonly gates: readonly string[];
  readonly prompts: readonly string[];
  readonly startedAt: Date;
  readonly endedAt: Date | null;
};
export type HarnessRunsGateway = {
  readonly read: {
    byId(runId: string): Promise<RunRow | null>;
    lock(runId: string): Promise<RunRow | null>;
    liveForItem(itemId: string): Promise<RunRow | null>;
    live(harnessId: string | null): Promise<readonly RunRow[]>;
  };
  readonly write: {
    insert(run: RunRow): Promise<void>;
    update(run: RunRow): Promise<boolean>;
  };
};

export type DrizzleTransaction = {
  lock(key: string): Promise<void>;
  readonly harnesses: HarnessesGateway;
  readonly harnessStages: HarnessStagesGateway;
  readonly harnessItems: HarnessItemsGateway;
  readonly harnessEvents: HarnessEventsGateway;
  readonly harnessRuns: HarnessRunsGateway;
  readonly gateDecisions: GateDecisionsGateway;
  readonly delegations: DelegationsGateway;
  readonly pages: PagesGateway;
};
