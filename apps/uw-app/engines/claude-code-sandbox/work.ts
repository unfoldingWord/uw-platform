import { z } from 'zod';
import { TURN_LIMIT } from '@uw/harness';
import type { EngineConfig } from '../config.ts';
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
const SCRIPT = `exec claude -p "$(cat ${WORKSPACE}/PROMPT.md)" "$@"`;

const resultSchema = z.object({
  subtype: z.string(),
  result: z.string().nullable().optional(),
  total_cost_usd: z.number().nonnegative().nullable().optional(),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

function modelRoute(config: EngineConfig): ModelRoute | null {
  const upstream = gatewayUpstream(config, PROVIDER);
  const key = config.ANTHROPIC_API_KEY;
  if (upstream === null || !key) return null;
  return { host: MODEL_HOST, upstream, headers: { ...gatewayHeaders(config), 'x-api-key': key } };
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

function read(stdout: string): SandboxReading {
  const result = resultSchema.safeParse(parsed(stdout));
  if (!result.success) throw new Error('claude code answered no result');
  const { subtype, usage } = result.data;
  const cost = result.data.total_cost_usd;
  return {
    outcome: subtype === 'error_max_turns' ? 'turn_limit' : 'ended',
    text: result.data.result ?? null,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    costMicros: cost === null || cost === undefined ? null : Math.round(cost * 1_000_000),
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
