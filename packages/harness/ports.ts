import type {
  CapabilityWord,
  Connector,
  CostBasis,
  Engine,
  GateDecision,
  Grant,
  Harness,
  HarnessEvent,
  Identity,
  ItemState,
  NewHarnessEvent,
  PageStatus,
  PageType,
  PrincipalKind,
  RunShape,
  ShipRuleInput,
  Stage,
  VerbName,
} from '@uw/contracts';

export type Clock = { now(): Date };

export type Ids = { next(): string };

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
};
export type StagePosition = { readonly id: string; readonly position: number };

export type HarnessesGateway = {
  readonly read: {
    byId(harnessId: string): Promise<Harness | null>;
    byKey(key: string): Promise<Harness | null>;
    list(): Promise<readonly Harness[]>;
  };
  readonly write: { insert(harness: Harness, at: Date): Promise<void> };
};
export type HarnessStagesGateway = {
  readonly read: { forHarness(harnessId: string): Promise<readonly Stage[]> };
  readonly write: {
    insert(stage: Stage): Promise<void>;
    update(stage: Stage): Promise<void>;
    reposition(harnessId: string, positions: readonly StagePosition[]): Promise<void>;
  };
};
export type HarnessItemsGateway = {
  readonly read: {
    byId(itemId: string): Promise<ItemState | null>;
    lock(itemId: string): Promise<ItemState | null>;
    forHarness(harnessId: string): Promise<readonly ItemState[]>;
    heldInStage(harnessId: string, stageKey: string, at: Date): Promise<number>;
    lapsedLeases(at: Date, limit: number): Promise<readonly string[]>;
  };
  readonly write: {
    insert(item: ItemState, at: Date): Promise<void>;
    claim(claim: ItemClaim): Promise<boolean>;
    project(item: ItemState): Promise<void>;
  };
};
export type PagesGateway = {
  readonly read: { facts(pageIds: readonly string[]): Promise<readonly PageFacts[]> };
};
export type EventQuery = {
  readonly harnessId: string;
  readonly itemId: string | null;
  readonly after: number;
  readonly limit: number;
};
export type EventPage = { readonly events: readonly HarnessEvent[]; readonly next: number | null };
export type HarnessEventsGateway = {
  readonly read: { page(query: EventQuery): Promise<EventPage> };
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
  readonly read: { forItem(itemId: string): Promise<readonly GateDecisionRow[]> };
  readonly write: { insert(decision: GateDecisionRow): Promise<void> };
};

export type StoreTransaction = {
  lock(key: string): Promise<void>;
  readonly harnesses: HarnessesGateway;
  readonly harnessStages: HarnessStagesGateway;
  readonly harnessItems: HarnessItemsGateway;
  readonly harnessEvents: HarnessEventsGateway;
  readonly gateDecisions: GateDecisionsGateway;
  readonly delegations: DelegationsGateway;
  readonly pages: PagesGateway;
};

export type Store = {
  transaction<T>(work: (tx: StoreTransaction) => Promise<T>): Promise<T>;
  appliedMigrations(): Promise<readonly number[]>;
};

export type Grants = {
  resolve(personId: string, at: Date): Promise<readonly Grant[]>;
  resolveIn(tx: StoreTransaction, personId: string, at: Date): Promise<readonly Grant[]>;
  lockAndReread(tx: StoreTransaction, personId: string, at: Date): Promise<readonly Grant[]>;
};

export type PullRequestRef = NonNullable<ItemState['pullRequest']>;
export type PullRequestState = 'open' | 'closed' | 'merged';
export type CheckConclusion = NonNullable<ShipRuleInput['checks'][number]['conclusion']>;
export type CheckFact = {
  readonly name: string;
  readonly headSha: string;
  readonly conclusion: CheckConclusion | null;
};
export type ReviewState = 'approved' | 'changes_requested' | 'commented' | 'dismissed';
export type ReviewFact = {
  readonly reviewer: string;
  readonly commit: string;
  readonly state: ReviewState;
  readonly provider: string | null;
};
export type PullRequestFacts = {
  readonly ref: PullRequestRef;
  readonly state: PullRequestState;
  readonly draft: boolean;
  readonly head: string;
  readonly checks: readonly CheckFact[];
  readonly reviews: readonly ReviewFact[];
  readonly freshAt: Date;
};
export type GitHubFacts = { pullRequest(ref: PullRequestRef): Promise<PullRequestFacts | null> };

export type EffectConnector = Exclude<Connector, 'none'>;
export type ConnectorRequest = {
  readonly connector: EffectConnector;
  readonly harnessId: string;
  readonly itemId: string;
  readonly traceId: string;
  readonly pullRequest: PullRequestRef | null;
  readonly expectedHead: string | null;
  readonly message: string;
};
export type ConnectorOutcome =
  | { readonly outcome: 'succeeded'; readonly detail: Readonly<Record<string, string>> }
  | { readonly outcome: 'refused'; readonly reason: string };
export type Connectors = { run(request: ConnectorRequest): Promise<ConnectorOutcome> };

export type ToolCall = {
  readonly callId: string;
  readonly verb: VerbName;
  readonly input: unknown;
};
export type TurnMessage =
  | { readonly role: 'user'; readonly text: string }
  | {
      readonly role: 'assistant';
      readonly text: string | null;
      readonly toolCalls: readonly ToolCall[];
    }
  | {
      readonly role: 'tool';
      readonly callId: string;
      readonly verb: VerbName;
      readonly output: unknown;
      readonly isError: boolean;
    };
export type TurnUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMinor: number | null;
  readonly costBasis: CostBasis;
};
export type TurnRequest = {
  readonly engine: Engine;
  readonly model: string;
  readonly pinnedProvider: string | null;
  readonly persona: string;
  readonly instructions: string;
  readonly tools: readonly VerbName[];
  readonly messages: readonly TurnMessage[];
  readonly traceId: string;
};
export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refused';
export type TurnResult = {
  readonly toolCalls: readonly ToolCall[];
  readonly text: string | null;
  readonly stopReason: StopReason;
  readonly usage: TurnUsage;
  readonly resolvedProvider: string | null;
  readonly resolvedModel: string;
};
export type ModelEngine = { turn(request: TurnRequest): Promise<TurnResult> };

export type Hub = { wake(harnessId: string): Promise<void> };

export type WakeReason = 'gate_waiting' | 'delegation_lapsed' | 'run_failed' | 'stage_advanced';
export type Wake = {
  readonly personId: string;
  readonly harnessId: string;
  readonly itemId: string | null;
  readonly reason: WakeReason;
  readonly link: string;
  readonly traceId: string;
};
export type NotifyOutcome = 'sent' | 'dropped';
export type Notifier = { notify(wake: Wake): Promise<NotifyOutcome> };

export type RunState = 'running' | 'hibernated' | 'stopped' | 'completed' | 'failed';
export type RunAction = 'start' | 'hibernate' | 'resume' | 'stop';
export type RunStart = {
  readonly runId: string;
  readonly harnessId: string;
  readonly itemId: string;
  readonly persona: string;
  readonly runShape: RunShape;
  readonly engine: Engine;
  readonly traceId: string;
};
export type Runs = {
  start(run: RunStart): Promise<void>;
  hibernate(runId: string): Promise<void>;
  resume(runId: string): Promise<void>;
  stop(runId: string): Promise<void>;
  status(runId: string): Promise<RunState | null>;
};

export type Ports = {
  readonly clock: Clock;
  readonly ids: Ids;
  readonly store: Store;
  readonly grants: Grants;
  readonly githubFacts: GitHubFacts;
  readonly connectors: Connectors;
  readonly modelEngine: ModelEngine;
  readonly hub: Hub;
  readonly notifier: Notifier;
  readonly runs: Runs;
};

export type PortName = keyof Ports;

const portKeys: Readonly<Record<PortName, true>> = {
  clock: true,
  ids: true,
  store: true,
  grants: true,
  githubFacts: true,
  connectors: true,
  modelEngine: true,
  hub: true,
  notifier: true,
  runs: true,
};

export const portNames = Object.keys(portKeys) as readonly PortName[];
