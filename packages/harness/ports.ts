import type {
  ClosingRef,
  Connector,
  CostBasis,
  DeepLink,
  Engine,
  Grant,
  IssueRef,
  ItemState,
  JdArea,
  LiveScreen,
  PullRequestDeclaration,
  ReadFinding,
  ReviewVerdict,
  RunShape,
  ShipRuleInput,
  VerbName,
  WakeReason,
} from '@uw/contracts';
import type { GrantHolder, WakeDelivery } from './notify/types.ts';
import type { StoreTransaction } from './store-ports.ts';

export type { DeepLink, LiveScreen, WakeReason } from '@uw/contracts';
export type { GrantHolder, PushDecision, WakeDelivery, ZulipDecision } from './notify/types.ts';
export type * from './store-ports.ts';

export type Clock = { now(): Date };

export type Ids = { next(): string };

export type Store = {
  transaction<T>(work: (tx: StoreTransaction) => Promise<T>): Promise<T>;
  appliedMigrations(): Promise<readonly number[]>;
};

export type Grants = {
  resolve(personId: string, at: Date): Promise<readonly Grant[]>;
  resolveIn(tx: StoreTransaction, personId: string, at: Date): Promise<readonly Grant[]>;
  lockAndReread(tx: StoreTransaction, personId: string, at: Date): Promise<readonly Grant[]>;
  holders(area: JdArea, at: Date): Promise<readonly GrantHolder[]>;
};

export type PullRequestRef = NonNullable<ItemState['pullRequest']>;
export type PullRequestState = 'open' | 'closed' | 'merged';
export type CheckConclusion = NonNullable<ShipRuleInput['checks'][number]['conclusion']>;
export type CheckFact = {
  readonly checkId: number;
  readonly name: string;
  readonly headSha: string;
  readonly app: string | null;
  readonly conclusion: CheckConclusion | null;
};
export type ReviewState = 'approved' | 'changes_requested' | 'commented' | 'dismissed';
export type ReviewFact = {
  readonly reviewId: number;
  readonly reviewer: string;
  readonly commit: string;
  readonly state: ReviewState;
  readonly provider: string | null;
  readonly findings: readonly ReadFinding[];
  readonly submittedAt: Date | null;
};
export type ChangedFiles = {
  readonly head: string;
  readonly base: string;
  readonly paths: readonly string[];
};
export type HeadCommit = {
  readonly sha: string;
  readonly merge: boolean;
  readonly skipCi: boolean;
  readonly closes: readonly ClosingRef[];
};
export type BaseComparison = {
  readonly head: string;
  readonly base: string;
  readonly behindBy: number | null;
  readonly patchId: string | null;
  readonly commits: readonly HeadCommit[] | null;
  readonly patchIds: Readonly<Record<string, string>>;
};
export type PullRequestFacts = {
  readonly ref: PullRequestRef;
  readonly state: PullRequestState;
  readonly draft: boolean;
  readonly head: string;
  readonly headRef: string;
  readonly headRepo: string | null;
  readonly base: string;
  readonly baseRef: string;
  readonly defaultBranch: string;
  readonly checks: readonly CheckFact[];
  readonly reviews: readonly ReviewFact[];
  readonly files: ChangedFiles | null;
  readonly declaration: PullRequestDeclaration | null;
  readonly closes: readonly ClosingRef[] | null;
  readonly comparison: BaseComparison | null;
  readonly freshAt: Date;
};
export type DiffRange = { readonly base: string; readonly head: string };
export type DiffRead =
  | { readonly kind: 'diff'; readonly text: string; readonly bytes: number }
  | { readonly kind: 'too_large'; readonly bytes: number | null }
  | { readonly kind: 'unavailable'; readonly reason: string };
export type PullRequestAuthor = { readonly ref: PullRequestRef; readonly author: string };
export type IssueKey = { readonly repo: string; readonly number: number };
export type IssueFact = {
  readonly issue: IssueRef;
  readonly title: string;
  readonly open: boolean;
  readonly doneWhen: readonly string[];
  readonly blockedBy: readonly number[];
};
export type EpicFacts = {
  readonly epic: IssueFact;
  readonly subIssueCount: number;
  readonly subIssues: readonly IssueFact[];
};
export type GitHubFacts = {
  pullRequest(ref: PullRequestRef): Promise<PullRequestFacts | null>;
  refresh(ref: PullRequestRef): Promise<PullRequestFacts | null>;
  diff(ref: PullRequestRef, range: DiffRange, budgetBytes: number): Promise<DiffRead>;
  epic(key: IssueKey): Promise<EpicFacts | null>;
  authors(refs: readonly PullRequestRef[]): Promise<readonly PullRequestAuthor[]>;
};

export type EffectConnector = Exclude<Connector, 'none'>;
export type DecidedBase = { readonly sha: string; readonly ref: string };
export type ConnectorRequest = {
  readonly connector: EffectConnector;
  readonly harnessId: string;
  readonly itemId: string;
  readonly traceId: string;
  readonly pullRequest: PullRequestRef | null;
  readonly joined: boolean;
  readonly expectedHead: string | null;
  readonly expectedBase: DecidedBase | null;
  readonly repository: string | null;
  readonly title: string;
  readonly overrideReason: string | null;
};
export type ConnectorOutcome =
  | { readonly outcome: 'succeeded'; readonly detail: Readonly<Record<string, string>> }
  | { readonly outcome: 'refused'; readonly reason: string };
export type ReviewRequest = {
  readonly reviewer: string;
  readonly repository: string;
  readonly pullRequest: PullRequestRef;
  readonly head: string;
  readonly verdict: ReviewVerdict;
  readonly body: string;
  readonly traceId: string;
};
export type ReviewOutcome =
  | { readonly outcome: 'posted'; readonly reviewId: number }
  | { readonly outcome: 'refused'; readonly reason: string };
export type Connectors = {
  run(request: ConnectorRequest): Promise<ConnectorOutcome>;
  outcomeOf(request: ConnectorRequest): Promise<ConnectorOutcome | null>;
  review(request: ReviewRequest): Promise<ReviewOutcome>;
};
export type EffectHandler = Omit<Connectors, 'review'>;

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
  readonly costMicros: number | null;
  readonly costBasis: CostBasis;
};
export type Spend = {
  readonly spentMinor: number;
  readonly currency: string;
  readonly since: Date;
  readonly asOf: Date;
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
export type ModelEngine = {
  turn(request: TurnRequest): Promise<TurnResult>;
  spend(since: Date): Promise<Spend>;
};

export type PresenceQuery = {
  readonly harnessId: string;
  readonly personId: string;
  readonly screen: LiveScreen;
  readonly itemId: string | null;
};
export type Hub = {
  wake(harnessId: string): Promise<void>;
  present(query: PresenceQuery): Promise<boolean>;
};

export type WakeRecipient = { readonly personId: string; readonly present: boolean };
export type Wake = {
  readonly harnessId: string;
  readonly harnessKey: string;
  readonly jdArea: JdArea;
  readonly itemId: string | null;
  readonly itemRef: string | null;
  readonly topic: string;
  readonly reason: WakeReason;
  readonly link: DeepLink;
  readonly recipients: readonly WakeRecipient[];
  readonly at: Date;
  readonly traceId: string;
};
export type Notifier = { notify(wake: Wake): Promise<WakeDelivery> };

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
