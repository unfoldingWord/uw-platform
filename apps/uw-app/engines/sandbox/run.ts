import { notWiredCall, ProviderMismatchError } from '@uw/harness';
import type { EngineConfig } from '../config.ts';
import type { EngineWork, EngineWorkResult } from '../seam.ts';
import { egress, type EgressRoutes, type ModelRoute } from './egress.ts';
import type { ContainerHost, ExecResult } from './host.ts';
import { SandboxNotWiredError } from './not-wired.ts';
import {
  computeMinorOf,
  runSession,
  sessionIdOf,
  type SessionFile,
  type SessionRun,
  type SessionSpec,
} from './session.ts';

export type SandboxReading = {
  readonly outcome: 'ended' | 'turn_limit';
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
  files(input: EngineWork): readonly SessionFile[];
  command(input: EngineWork): readonly string[];
  read(ran: ExecResult): SandboxReading;
};

export const WORKSPACE = '/workspace';
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

export async function sandboxWork(
  config: EngineConfig,
  plan: SandboxPlan,
  input: EngineWork,
): Promise<EngineWorkResult> {
  if (plan.model === null) return notWiredCall('modelEngine', 'work');
  if (plan.host === null) throw new SandboxNotWiredError();
  if (input.pinnedProvider !== plan.provider) {
    throw new ProviderMismatchError(input.pinnedProvider, plan.provider);
  }
  const routes = { model: plan.model, ...input.egress };
  const spec = {
    sessionId: sessionIdOf(input.runId),
    files: plan.files(input),
    command: plan.command(input),
    env: plan.env,
    timeoutMs: SESSION_TIMEOUT_MS,
  };
  const ran = await guardedSession(plan.host, spec, routes, config, input.onTurn);
  const { model, ...reading } = plan.read(ran);
  return {
    ...reading,
    computeMinor: computeMinorOf(ran.wallMs, config.SANDBOX_MINOR_PER_HOUR),
    resolvedProvider: plan.provider,
    resolvedModel: model ?? input.model,
    toolsCalled: [],
  };
}
