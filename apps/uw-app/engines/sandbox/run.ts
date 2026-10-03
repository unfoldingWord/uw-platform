import { notWiredCall, ProviderMismatchError } from '@uw/harness';
import type { EngineConfig } from '../config.ts';
import type { EngineWork, EngineWorkResult } from '../seam.ts';
import { egress, type ModelRoute } from './egress.ts';
import type { ContainerHost } from './host.ts';
import { SandboxNotWiredError } from './not-wired.ts';
import { computeMinorOf, runSession, sessionIdOf, type SessionFile } from './session.ts';

export type SandboxReading = {
  readonly outcome: 'ended' | 'turn_limit';
  readonly text: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicros: number | null;
};

export type SandboxPlan = {
  readonly host: ContainerHost | null;
  readonly model: ModelRoute | null;
  readonly provider: string;
  readonly env: Readonly<Record<string, string>>;
  files(input: EngineWork): readonly SessionFile[];
  command(input: EngineWork): readonly string[];
  read(stdout: string): SandboxReading;
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
  const now = config.now ?? (() => new Date());
  const routes = { model: plan.model, ...input.egress };
  const ran = await runSession(
    plan.host,
    {
      sessionId: sessionIdOf(input.runId),
      files: plan.files(input),
      command: plan.command(input),
      env: plan.env,
      timeoutMs: SESSION_TIMEOUT_MS,
      egress: (request) => egress(request, routes, config.fetch),
    },
    now,
  );
  const reading = plan.read(ran.stdout);
  return {
    ...reading,
    computeMinor: computeMinorOf(ran.wallMs, config.SANDBOX_MINOR_PER_HOUR),
    resolvedProvider: plan.provider,
    resolvedModel: input.model,
    toolsCalled: [],
  };
}
