import { describe, expect, it } from 'vitest';
import type { EngineWork } from '../seam.ts';
import { sandboxWork } from '../sandbox/run.ts';
import { fakeContainerHost } from '../sandbox/testing.ts';
import { claudeCodeSandboxEngine } from './index.ts';
import { claudeCodePlan } from './work.ts';

const keys = {
  AI_GATEWAY_ACCOUNT_ID: 'account-1',
  AI_GATEWAY_ID: 'harness-gateway',
  AI_GATEWAY_TOKEN: 'gateway-token',
  ANTHROPIC_API_KEY: 'organization-key',
};
const head = 'c'.repeat(40);
const result = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Fixed.',
  total_cost_usd: 0.1,
  usage: { input_tokens: 1200, output_tokens: 340 },
};

const fixWork: EngineWork = {
  runId: 'run-1',
  itemId: 'item-1',
  traceId: 'trace-1',
  persona: 'agent:builder',
  model: 'claude-sonnet-5',
  pinnedProvider: 'anthropic',
  instructions: 'You build the item.',
  prompt: 'Fix the item.',
  toolset: ['read_page'],
  checkout: {
    repository: 'unfoldingWord/uw-platform',
    branch: 'harness/item-1',
    defaultBranch: 'main',
    expectedHead: head,
    fix: true,
  },
  tools: { call: () => Promise.reject(new Error('the sandbox calls tools over MCP')) },
  onTurn: async () => undefined,
  egress: {
    mcp: async () => Response.json({ jsonrpc: '2.0', id: 1, result: {} }),
    github: { token: async () => 'ghs_minted', unwired: () => undefined },
    refused: () => undefined,
  },
};

function engineOn(replies: Parameters<typeof fakeContainerHost>[0]) {
  const host = fakeContainerHost(replies);
  const sent: Request[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    sent.push(new Request(input, init));
    return Response.json({ ok: true });
  };
  const sandboxes = { claudeCode: host, codex: null };
  const config = { ...keys, fetch, sandboxes, now: () => new Date(0) };
  return { engine: claudeCodeSandboxEngine(config), config, host, sent };
}

function reply(body: unknown, exitCode = 0) {
  return { exitCode, stdout: JSON.stringify(body), stderr: '' };
}

function pushed(): Request {
  const update = `${'a'.repeat(40)} ${'b'.repeat(40)} refs/heads/harness/item-1\0report-status\n`;
  const body = `${(update.length + 4).toString(16).padStart(4, '0')}${update}0000PACK`;
  return new Request('http://github.internal/unfoldingWord/uw-platform.git/git-receive-pack', {
    method: 'POST',
    body,
  });
}

const registryGet = () => new Request('http://registry.internal/react');

async function noChecks(): Promise<void> {
  const { engine, host } = engineOn([{ exitCode: 78, stdout: '', stderr: '' }]);
  expect(await engine.work(fixWork)).toMatchObject({
    outcome: 'checks_not_run_locally',
    inputTokens: 0,
    outputTokens: 0,
  });
  const [session] = host.sessions;
  expect(session?.commands).toHaveLength(1);
  const script = session?.commands[0]?.command[2] ?? '';
  const declared =
    'git -C /workspace/repo show "$UW_START:.harness/checks.sh" > /workspace/checks.sh';
  expect(script.indexOf(declared)).toBeGreaterThan(-1);
  expect(script.indexOf(declared)).toBeLessThan(script.indexOf('exec claude'));
}

async function failingChecks(): Promise<void> {
  const statuses: number[] = [];
  const { engine, host, sent } = engineOn([
    async (egress) => {
      statuses.push((await egress(pushed())).status, (await egress(registryGet())).status);
      return reply(result);
    },
    async (egress) => {
      statuses.push((await egress(registryGet())).status);
      return { exitCode: 1, stdout: '', stderr: 'lint failed' };
    },
  ]);
  expect(await engine.work(fixWork)).toMatchObject({
    outcome: 'checks_not_run_locally',
    inputTokens: 1200,
  });
  expect(statuses).toEqual([403, 403, 200]);
  expect(host.sessions[0]?.commands).toHaveLength(2);
  expect(sent.map((request) => request.url)).toEqual(['https://registry.npmjs.org/react']);
}

async function passingChecks(): Promise<void> {
  const statuses: number[] = [];
  const { engine, host, sent } = engineOn([
    reply(result),
    { exitCode: 0, stdout: 'ok', stderr: '' },
    async (egress) => {
      statuses.push((await egress(pushed())).status);
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  ]);
  expect(await engine.work(fixWork)).toMatchObject({ outcome: 'ended', text: 'Fixed.' });
  expect(statuses).toEqual([200]);
  const commands = host.sessions[0]?.commands ?? [];
  expect(commands[2]?.command.join(' ')).toContain('push origin "HEAD:refs/heads/$UW_BRANCH"');
  expect(commands[1]?.env).toMatchObject({ npm_config_registry: 'http://registry.internal/' });
  expect(commands[0]?.command.join(' ')).not.toContain('Bash(curl *)');
  const prompt = host.sessions[0]?.files.find((file) => file.path === '/workspace/PROMPT.md');
  expect(prompt?.content).toContain('Do not push');
  expect(sent.map((request) => request.url)).toEqual([
    'https://github.com/unfoldingWord/uw-platform.git/git-receive-pack',
  ]);
}

async function noFixSpec(): Promise<void> {
  const { config, host } = engineOn([]);
  const plan = { ...claudeCodePlan(config), finish: null };
  expect(await sandboxWork(config, plan, fixWork)).toMatchObject({
    outcome: 'checks_not_run_locally',
  });
  expect(host.sessions).toEqual([]);
}

describe('FL-4 the fix work spec runs the declared checks before anything is pushed', () => {
  it(
    'FL-4 with no declared checks the run ends checks_not_run_locally before the model runs',
    noChecks,
  );

  it(
    'FL-4 failing checks end checks_not_run_locally; the model could not push and nothing was pushed',
    failingChecks,
  );

  it('FL-4 passing checks let the platform push the fix from its own command', passingChecks);

  it(
    'FL-4 an engine with no fix work spec ends checks_not_run_locally without a session',
    noFixSpec,
  );
});
