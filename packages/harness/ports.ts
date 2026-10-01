import type { Connector, CostBasis, Engine, Grant, RunShape, VerbName } from '@uw/contracts';

export type Clock = { now(): Date };

export type Ids = { next(): string };

export type StoreTransaction = { lock(key: string): Promise<void> };

export type Store = {
  transaction<T>(work: (tx: StoreTransaction) => Promise<T>): Promise<T>;
  appliedMigrations(): Promise<readonly number[]>;
};

export type Grants = {
  resolve(personId: string, at: Date): Promise<readonly Grant[]>;
  lockAndReread(tx: StoreTransaction, personId: string, at: Date): Promise<readonly Grant[]>;
};

export type PullRequestRef = { readonly repo: string; readonly number: number };
export type PullRequestState = 'open' | 'closed' | 'merged';
export type CheckConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'action_required'
  | 'stale';
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
