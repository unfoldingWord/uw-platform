import { z } from 'zod';
import type { EngineConfig } from '../config.ts';
import { MCP_HOST, MODEL_HOST, type ModelRoute } from '../sandbox/egress.ts';
import {
  gatewayHeaders,
  gatewayUpstream,
  promptFile,
  WORKSPACE,
  type SandboxPlan,
  type SandboxReading,
} from '../sandbox/run.ts';
import type { EngineWork } from '../seam.ts';

const PROVIDER = 'openai';
const INFERENCE_PATHS = ['/responses'];
const SCRIPT = `exec codex exec --json --skip-git-repo-check --cd ${WORKSPACE} "$(cat ${WORKSPACE}/PROMPT.md)"`;

const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
});
const messageSchema = z.object({
  type: z.literal('agent_message'),
  text: z.string().optional(),
  message: z.string().optional(),
});
const countSchema = z.object({ type: z.literal('token_count') }).and(usageSchema);
const turnSchema = z.object({ type: z.literal('turn.completed'), usage: usageSchema });

type Usage = { inputTokens: number; outputTokens: number };

function modelRoute(config: EngineConfig): ModelRoute | null {
  const upstream = gatewayUpstream(config, PROVIDER);
  const key = config.OPENAI_API_KEY;
  if (upstream === null || !key) return null;
  const headers = { ...gatewayHeaders(config), authorization: `Bearer ${key}` };
  return { host: MODEL_HOST, upstream, headers, paths: INFERENCE_PATHS };
}

function configToml(input: EngineWork): string {
  return [
    `model = ${JSON.stringify(input.model)}`,
    'model_provider = "uw-gateway"',
    '',
    '[model_providers.uw-gateway]',
    'name = "AI Gateway"',
    `base_url = "http://${MODEL_HOST}"`,
    'wire_api = "responses"',
    '',
    '[mcp_servers.uw-platform]',
    `url = "http://${MCP_HOST}/mcp"`,
    '',
  ].join('\n');
}

function lineOf(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return null;
  }
}

function eventsOf(stdout: string): unknown[] {
  return stdout
    .split('\n')
    .map(lineOf)
    .filter((event): event is object => typeof event === 'object' && event !== null)
    .map((event) => ('msg' in event ? event.msg : 'item' in event ? event.item : event));
}

function counted(usage: Usage, event: unknown): void {
  const tokens = countSchema.safeParse(event);
  const turn = turnSchema.safeParse(event);
  const found = tokens.success ? tokens.data : turn.success ? turn.data.usage : null;
  if (found === null) return;
  usage.inputTokens += found.input_tokens;
  usage.outputTokens += found.output_tokens;
}

function read(stdout: string): SandboxReading {
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let text: string | null = null;
  for (const event of eventsOf(stdout)) {
    const message = messageSchema.safeParse(event);
    if (message.success) text = message.data.text ?? message.data.message ?? text;
    counted(usage, event);
  }
  if (text === null) throw new Error('codex answered no message');
  return { outcome: 'ended', text, ...usage, costMicros: null };
}

export function codexPlan(config: EngineConfig): SandboxPlan {
  return {
    host: config.sandboxes?.codex ?? null,
    model: modelRoute(config),
    provider: PROVIDER,
    env: { HOME: WORKSPACE },
    files: (input) => [
      { path: `${WORKSPACE}/.codex/config.toml`, content: configToml(input) },
      promptFile(input),
    ],
    command: () => ['sh', '-c', SCRIPT],
    read,
  };
}
