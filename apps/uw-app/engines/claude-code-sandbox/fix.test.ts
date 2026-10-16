import { afterEach, describe, expect, it, vi } from 'vitest';
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

const checked = 'b'.repeat(40);
const declared = 'pnpm install --frozen-lockfile\npnpm test\n';
const prepared = { exitCode: 0, stdout: declared, stderr: '' };
const inspected = { exitCode: 0, stdout: `${checked}\n`, stderr: '' };
const passed = { exitCode: 0, stdout: 'ok', stderr: '' };

function pushed(sha = checked): Request {
  const update = `${'a'.repeat(40)} ${sha} refs/heads/harness/item-1\0report-status\n`;
  const body = `${(update.length + 4).toString(16).padStart(4, '0')}${update}0000PACK`;
  return new Request('http://github.internal/unfoldingWord/uw-platform.git/git-receive-pack', {
    method: 'POST',
    body,
  });
}

const registryGet = () => new Request('http://registry.internal/react');
const inference = () =>
  new Request('http://model.internal/v1/messages', { method: 'POST', body: '{}' });
const verb = () => new Request('http://mcp.internal/mcp', { method: 'POST', body: '{}' });

type Commands = readonly { readonly command: readonly string[] }[];

function line(commands: Commands, index: number): string {
  return commands[index]?.command.join(' ') ?? '';
}

afterEach(() => {
  vi.useRealTimers();
});

async function noChecks(): Promise<void> {
  const { engine, host } = engineOn([{ exitCode: 78, stdout: '', stderr: '' }]);
  expect(await engine.work(fixWork)).toMatchObject({
    outcome: 'checks_not_run_locally',
    inputTokens: 0,
    outputTokens: 0,
  });
  const commands = host.sessions[0]?.commands ?? [];
  expect(commands).toHaveLength(1);
  expect(line(commands, 0)).toContain('git -C /workspace/repo show "$UW_START:.harness/checks.sh"');
  expect(line(commands, 0)).not.toContain('claude');
}

async function startCommitText(): Promise<void> {
  let filesAtModel = -1;
  const { engine, host } = engineOn([
    prepared,
    async () => {
      filesAtModel = host.sessions[0]?.files.length ?? -1;
      return reply(result);
    },
    inspected,
    passed,
    passed,
  ]);
  expect(await engine.work(fixWork)).toMatchObject({ outcome: 'ended' });
  const session = host.sessions[0];
  const commands = session?.commands ?? [];
  const script = session?.files.find((file) => file.path.startsWith('/workspace/declared-checks-'));
  expect(script?.content).toBe(declared);
  expect(session?.files.indexOf(script ?? { path: '', content: '' })).toBeGreaterThanOrEqual(
    filesAtModel,
  );
  expect(line(commands, 3)).toContain(`sh ${script?.path ?? 'missing'}`);
  expect(line(commands, 1)).not.toContain('checks.sh');
}

async function failingChecks(): Promise<void> {
  const statuses: number[] = [];
  const { engine, host, sent } = engineOn([
    prepared,
    async (egress) => {
      statuses.push((await egress(pushed())).status, (await egress(registryGet())).status);
      return reply(result);
    },
    inspected,
    async (egress) => {
      statuses.push((await egress(registryGet())).status);
      statuses.push((await egress(inference())).status, (await egress(verb())).status);
      return { exitCode: 1, stdout: '', stderr: 'lint failed' };
    },
  ]);
  expect(await engine.work(fixWork)).toMatchObject({
    outcome: 'checks_not_run_locally',
    inputTokens: 1200,
  });
  expect(statuses).toEqual([403, 403, 200, 403, 403]);
  expect(host.sessions[0]?.commands).toHaveLength(4);
  expect(sent.map((request) => request.url)).toEqual(['https://registry.npmjs.org/react']);
}

async function passingChecks(): Promise<void> {
  const statuses: number[] = [];
  const { engine, host, sent } = engineOn([
    prepared,
    reply(result),
    inspected,
    passed,
    async (egress) => {
      statuses.push((await egress(pushed())).status);
      return passed;
    },
  ]);
  expect(await engine.work(fixWork)).toMatchObject({ outcome: 'ended', text: 'Fixed.' });
  expect(statuses).toEqual([200]);
  const session = host.sessions[0];
  const commands = session?.commands ?? [];
  expect(line(commands, 4)).toContain(`push --no-verify --quiet "$UW_CLONE_URL" "${checked}:`);
  expect(line(commands, 4)).toContain('core.hooksPath=/dev/null');
  expect(line(commands, 4)).toContain('GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1');
  expect(session?.commands[3]?.env).toMatchObject({
    npm_config_registry: 'http://registry.internal/',
  });
  expect(line(commands, 1)).not.toContain('Bash(curl *)');
  const configs = session?.files.filter((file) => file.path === '/workspace/repo/.git/config');
  expect(configs?.map((file) => file.content.includes('hooksPath'))).toEqual([false, false]);
  const prompt = session?.files.find((file) => file.path === '/workspace/PROMPT.md');
  expect(prompt?.content).toContain('Do not push');
  expect(sent.map((request) => request.url)).toEqual([
    'https://github.com/unfoldingWord/uw-platform.git/git-receive-pack',
  ]);
}

async function dirtyTree(): Promise<void> {
  const { engine, host } = engineOn([
    prepared,
    reply(result),
    { exitCode: 1, stdout: '', stderr: '' },
  ]);
  expect(await engine.work(fixWork)).toMatchObject({ outcome: 'checks_not_run_locally' });
  const commands = host.sessions[0]?.commands ?? [];
  expect(commands).toHaveLength(3);
  expect(line(commands, 2)).toContain('status --porcelain');
}

async function headMoved(): Promise<void> {
  const statuses: number[] = [];
  const { engine, sent } = engineOn([
    prepared,
    reply(result),
    inspected,
    passed,
    async (egress) => {
      statuses.push((await egress(pushed('d'.repeat(40)))).status);
      return { exitCode: 1, stdout: '', stderr: 'rejected' };
    },
  ]);
  expect(await engine.work(fixWork)).toMatchObject({ outcome: 'checks_not_run_locally' });
  expect(statuses).toEqual([403]);
  expect(sent).toEqual([]);
}

async function leaseRenewed(): Promise<void> {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  let turns = 0;
  let duringChecks = 0;
  const { engine } = engineOn([
    prepared,
    reply(result),
    inspected,
    async () => {
      const before = turns;
      await vi.advanceTimersByTimeAsync(3 * 60_000);
      duringChecks = turns - before;
      return passed;
    },
    passed,
  ]);
  const work = {
    ...fixWork,
    onTurn: async () => {
      turns += 1;
    },
  };
  expect(await engine.work(work)).toMatchObject({ outcome: 'ended' });
  expect(duringChecks).toBe(3);
  expect(turns).toBe(5);
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
    'FL-4 the checks run the start commit text the host read before the model ran',
    startCommitText,
  );

  it(
    'FL-4 failing checks end checks_not_run_locally; the model could not push and nothing was pushed',
    failingChecks,
  );

  it(
    'FL-4 passing checks let the platform push the checked commit from its own command',
    passingChecks,
  );

  it(
    'FL-4 an engine with no fix work spec ends checks_not_run_locally without a session',
    noFixSpec,
  );
});

describe('FL-4 the platform pushes only the commit the checks ran on', () => {
  it('FL-4 a tree with uncommitted changes runs no checks and pushes nothing', dirtyTree);

  it('FL-4 a push of any commit but the checked one is refused at the egress', headMoved);

  it('FL-4 the lease is renewed while the declared checks run', leaseRenewed);
});
