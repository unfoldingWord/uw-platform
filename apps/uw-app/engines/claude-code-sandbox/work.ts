import { z } from 'zod';
import { modelIdSchema } from '@uw/contracts';
import { TURN_LIMIT } from '@uw/harness';
import type { EngineConfig } from '../config.ts';
import type { ExecResult } from '../sandbox/host.ts';
import { MCP_HOST, MODEL_HOST, type ModelRoute } from '../sandbox/egress.ts';
import {
  gatewayHeaders,
  gatewayUpstream,
  PLACEHOLDER_KEY,
  promptFile,
  WORKSPACE,
  type SandboxPlan,
  type SandboxReading,
} from '../sandbox/run.ts';
import type { EngineWork } from '../seam.ts';

const PROVIDER = 'anthropic';
const MCP_CONFIG = `${WORKSPACE}/.mcp.json`;
const SERVER = 'uw-platform';
const INFERENCE_PATHS = ['/v1/messages', '/v1/messages/count_tokens'];
const SCRIPT = `exec claude -p "$(cat ${WORKSPACE}/PROMPT.md)" "$@"`;

const servedSchema = z.object({ outputTokens: z.number().int().nonnegative() });
const resultSchema = z.object({
  subtype: z.string(),
  is_error: z.boolean().optional(),
  result: z.string().nullable().optional(),
  total_cost_usd: z.number().nonnegative().nullable().optional(),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
  modelUsage: z.record(z.string(), servedSchema).optional(),
});
const MAX_TURNS = 'error_max_turns';

function modelRoute(config: EngineConfig): ModelRoute | null {
  const upstream = gatewayUpstream(config, PROVIDER);
  const key = config.ANTHROPIC_API_KEY;
  if (upstream === null || !key) return null;
  const headers = { ...gatewayHeaders(config), 'x-api-key': key };
  return { host: MODEL_HOST, upstream, headers, paths: INFERENCE_PATHS };
}

function files(input: EngineWork) {
  const servers = { [SERVER]: { type: 'http', url: `http://${MCP_HOST}/mcp` } };
  return [
    { path: MCP_CONFIG, content: JSON.stringify({ mcpServers: servers }) },
    promptFile(input),
  ];
}

function command(input: EngineWork): readonly string[] {
  const allowed = input.toolset.map((verb) => `mcp__${SERVER}__${verb}`).join(',');
  return [
    'sh',
    '-c',
    SCRIPT,
    'claude',
    '--output-format',
    'json',
    '--mcp-config',
    MCP_CONFIG,
    '--allowedTools',
    allowed,
    '--max-turns',
    TURN_LIMIT.toString(),
    '--model',
    input.model,
  ];
}

function parsed(stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    return null;
  }
}

function servedModel(usage: Readonly<Record<string, { outputTokens: number }>> | undefined) {
  let served: { readonly model: string; readonly outputTokens: number } | null = null;
  for (const [model, { outputTokens }] of Object.entries(usage ?? {})) {
    if (!modelIdSchema.safeParse(model).success) continue;
    if (served === null || outputTokens > served.outputTokens) served = { model, outputTokens };
  }
  return served?.model ?? null;
}

function failedRun(exitCode: number, errored: boolean): void {
  if (exitCode !== 0) throw new Error(`claude code exited ${exitCode.toString()}`);
  if (errored) throw new Error('claude code answered an error');
}

function read(ran: ExecResult): SandboxReading {
  const result = resultSchema.safeParse(parsed(ran.stdout));
  if (!result.success) throw new Error('claude code answered no result');
  const { subtype, usage } = result.data;
  const text = result.data.result ?? null;
  const limited = subtype === MAX_TURNS;
  if (!limited) failedRun(ran.exitCode, result.data.is_error === true && text === null);
  const cost = result.data.total_cost_usd;
  return {
    outcome: limited ? 'turn_limit' : 'ended',
    text,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    costMicros: cost === null || cost === undefined ? null : Math.round(cost * 1_000_000),
    model: servedModel(result.data.modelUsage),
  };
}

export function claudeCodePlan(config: EngineConfig): SandboxPlan {
  return {
    host: config.sandboxes?.claudeCode ?? null,
    model: modelRoute(config),
    provider: PROVIDER,
    env: {
      ANTHROPIC_BASE_URL: `http://${MODEL_HOST}`,
      ANTHROPIC_API_KEY: PLACEHOLDER_KEY,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      HOME: WORKSPACE,
    },
    files,
    command,
    read,
  };
}
