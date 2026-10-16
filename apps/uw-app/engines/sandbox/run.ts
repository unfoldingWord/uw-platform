import { notWiredCall, ProviderMismatchError } from '@uw/harness';
import type { EngineConfig } from '../config.ts';
import type { EngineWork, EngineWorkResult } from '../seam.ts';
import { egress, type EgressRoutes, type ModelRoute } from './egress.ts';
import { fixPhase, NO_CHECKS_EXIT, type FixPhase } from './fix-checks.ts';
import { GITHUB_HOST, type GitHubEgress } from './github-egress.ts';
import type { ContainerHost, ExecResult } from './host.ts';
import { SandboxNotWiredError } from './not-wired.ts';
import { WORKSPACE } from './paths.ts';
import {
  computeMinorOf,
  runSession,
  sessionIdOf,
  type SessionFile,
  type SessionFinish,
  type SessionRun,
  type SessionSpec,
} from './session.ts';

export type SandboxReading = {
  readonly outcome: 'ended' | 'turn_limit' | 'checks_not_run_locally';
  readonly text: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicros: number | null;
  readonly model: string | null;
};

export type SandboxPlan = {
  readonly host: ContainerHost | null;
  readonly model: ModelRoute | null;
  readonly provider: string;
  readonly env: Readonly<Record<string, string>>;
  readonly clones: boolean;
  files(input: EngineWork): readonly SessionFile[];
  command(input: EngineWork): readonly string[];
  read(ran: ExecResult): SandboxReading;
  readonly finish: ((input: EngineWork, phase: FixPhase) => SessionFinish) | null;
};

export { REPOSITORY_DIR, WORKSPACE } from './paths.ts';
export const PLACEHOLDER_KEY = 'sk-placeholder-replaced-at-the-egress-proxy';
const SESSION_TIMEOUT_MS = 25 * 60 * 1000;

export function promptFile(input: EngineWork): SessionFile {
  return { path: `${WORKSPACE}/PROMPT.md`, content: `${input.instructions}\n\n${input.prompt}` };
}

export function gatewayUpstream(config: EngineConfig, provider: string): string | null {
  const account = config.AI_GATEWAY_ACCOUNT_ID;
  const gateway = config.AI_GATEWAY_ID;
  if (!account || !gateway) return null;
  return `https://gateway.ai.cloudflare.com/v1/${account}/${gateway}/${provider}`;
}

export function gatewayHeaders(config: EngineConfig): Readonly<Record<string, string>> {
  const token = config.AI_GATEWAY_TOKEN;
  return token ? { 'cf-aig-authorization': `Bearer ${token}` } : {};
}

type TurnGate = {
  readonly admit: () => Promise<boolean>;
  rethrow(): void;
};

function turnGate(onTurn: () => Promise<void>): TurnGate {
  let halt: { readonly error: unknown } | null = null;
  let queue: Promise<boolean> = Promise.resolve(true);
  const checked = async (): Promise<boolean> => {
    if (halt !== null) return false;
    try {
      await onTurn();
      return true;
    } catch (error) {
      halt = { error };
      return false;
    }
  };
  return {
    admit: () => {
      queue = queue.then(checked);
      return queue;
    },
    rethrow: () => {
      if (halt !== null) throw halt.error;
    },
  };
}

async function guardedSession(
  host: ContainerHost,
  spec: Omit<SessionSpec, 'egress'>,
  routes: Omit<EgressRoutes, 'admit'>,
  config: EngineConfig,
  onTurn: () => Promise<void>,
): Promise<SessionRun> {
  const gate = turnGate(onTurn);
  const guarded: EgressRoutes = { ...routes, admit: gate.admit };
  const now = config.now ?? (() => new Date());
  try {
    const egressOf = (request: Request) => egress(request, guarded, config.fetch);
    const ran = await runSession(host, { ...spec, egress: egressOf }, now);
    gate.rethrow();
    return ran;
  } catch (error) {
    gate.rethrow();
    throw error;
  }
}

function envOf(plan: SandboxPlan, input: EngineWork): Readonly<Record<string, string>> {
  const { checkout } = input;
  if (!plan.clones || checkout === null) return plan.env;
  return {
    ...plan.env,
    UW_CLONE_URL: `http://${GITHUB_HOST}/${checkout.repository}.git`,
    UW_BRANCH: checkout.branch,
    UW_START: checkout.expectedHead ?? `origin/${checkout.defaultBranch}`,
  };
}

function githubOf(plan: SandboxPlan, input: EngineWork, phase: FixPhase): GitHubEgress | null {
  const { checkout } = input;
  const access = input.egress.github;
  if (!plan.clones || checkout === null || access === null) return null;
  const { repository, branch, defaultBranch } = checkout;
  return { repository, branch, defaultBranch, ...access, pushes: phase.pushes };
}

const unread: SandboxReading = {
  outcome: 'checks_not_run_locally',
  text: null,
  inputTokens: 0,
  outputTokens: 0,
  costMicros: null,
  model: null,
};

function readingOf(plan: SandboxPlan, ran: SessionRun): SandboxReading {
  if (ran.finished !== 'checks_not_run_locally') return plan.read(ran);
  if (ran.exitCode === NO_CHECKS_EXIT) return unread;
  return { ...plan.read(ran), outcome: 'checks_not_run_locally' };
}

function unrunFix(plan: SandboxPlan, input: EngineWork): EngineWorkResult {
  const { model, ...reading } = unread;
  return {
    ...reading,
    computeMinor: null,
    resolvedProvider: plan.provider,
    resolvedModel: model ?? input.model,
    toolsCalled: [],
  };
}

type Finish = NonNullable<SandboxPlan['finish']>;

type Wired = SandboxPlan & { readonly model: ModelRoute };

function sessionOf(plan: Wired, input: EngineWork, finish: Finish | null) {
  const phase = fixPhase(finish !== null);
  const registry = finish === null ? null : { open: phase.installs };
  const github = githubOf(plan, input, phase);
  const routes = { ...input.egress, model: plan.model, github, registry };
  const spec = {
    sessionId: sessionIdOf(input.runId),
    files: plan.files(input),
    command: plan.command(input),
    env: envOf(plan, input),
    timeoutMs: SESSION_TIMEOUT_MS,
    finish: finish === null ? null : finish(input, phase),
  };
  return { routes, spec };
}

export async function sandboxWork(
  config: EngineConfig,
  plan: SandboxPlan,
  input: EngineWork,
): Promise<EngineWorkResult> {
  const { model: route } = plan;
  if (route === null) return notWiredCall('modelEngine', 'work');
  if (plan.host === null) throw new SandboxNotWiredError();
  if (input.pinnedProvider !== plan.provider) {
    throw new ProviderMismatchError(input.pinnedProvider, plan.provider);
  }
  const fixing = input.checkout?.fix === true;
  const finish = fixing ? plan.finish : null;
  if (fixing && finish === null) return unrunFix(plan, input);
  const { routes, spec } = sessionOf({ ...plan, model: route }, input, finish);
  const ran = await guardedSession(plan.host, spec, routes, config, input.onTurn);
  const { model, ...reading } = readingOf(plan, ran);
  return {
    ...reading,
    computeMinor: computeMinorOf(ran.wallMs, config.SANDBOX_MINOR_PER_HOUR),
    resolvedProvider: plan.provider,
    resolvedModel: model ?? input.model,
    toolsCalled: [],
  };
}
