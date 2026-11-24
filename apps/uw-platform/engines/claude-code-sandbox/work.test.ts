import type { EngineWork } from '../seam.ts';
import { describe, expect, it } from 'vitest';
import { fakeContainerHost, type FakeContainerHost } from '../sandbox/testing.ts';
import { claudeCodeSandboxEngine } from './index.ts';

const keys = {
  AI_GATEWAY_ACCOUNT_ID: 'account-1',
  AI_GATEWAY_ID: 'harness-gateway',
  AI_GATEWAY_TOKEN: 'gateway-token',
  ANTHROPIC_API_KEY: 'organization-key',
};

const work: EngineWork = {
  runId: 'run-1',
  itemId: 'item-1',
  traceId: 'trace-1',
  persona: 'agent:builder',
  model: 'claude-sonnet-5',
  pinnedProvider: 'anthropic',
  instructions: 'You build the item.',
  prompt: 'Work the item.',
  toolset: ['read_page', 'claim_item'],
  checkout: null,
  tools: { call: () => Promise.reject(new Error('the sandbox calls tools over MCP')) },
  onTurn: async () => undefined,
  egress: {
    mcp: async () => Response.json({ jsonrpc: '2.0', id: 1, result: {} }),
    github: null,
    refused: () => undefined,
  },
};

const result = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Done: the board is built.',
  num_turns: 7,
  total_cost_usd: 0.4321,
  usage: { input_tokens: 1200, output_tokens: 340 },
};

function clockAt(minutes: readonly number[]): () => Date {
  let index = 0;
  return () => {
    const at = minutes[Math.min(index, minutes.length - 1)] ?? 0;
    index += 1;
    return new Date(at * 60_000);
  };
}

function engineOn(host: FakeContainerHost | null, settings: Record<string, string> = {}) {
  const sent: Request[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    sent.push(new Request(input, init));
    return Response.json({ ok: true });
  };
  const sandboxes = { claudeCode: host, codex: null };
  const engine = claudeCodeSandboxEngine({
    ...keys,
    ...settings,
    fetch,
    sandboxes,
    now: clockAt([0, 45]),
  });
  return { engine, sent };
}

function reply(body: unknown, exitCode = 0) {
  return { exitCode, stdout: JSON.stringify(body), stderr: '' };
}

type Session = FakeContainerHost['sessions'][number];

function expectHeadlessCommand(session: Session | undefined): void {
  expect(session?.id).toMatch(/^run-run-1-/);
  const files = new Map(session?.files.map((file) => [file.path, file.content]));
  expect(JSON.parse(files.get('/workspace/.mcp.json') ?? '{}')).toEqual({
    mcpServers: { 'uw-platform': { type: 'http', url: 'http://mcp.internal/mcp' } },
  });
  expect(files.get('/workspace/PROMPT.md')).toBe('You build the item.\n\nWork the item.');
  const [run] = session?.commands ?? [];
  expect(run?.command).toEqual(
    expect.arrayContaining([
      '--output-format',
      'json',
      '--mcp-config',
      '/workspace/.mcp.json',
      '--allowedTools',
      'mcp__uw-platform__read_page,mcp__uw-platform__claim_item',
      '--max-turns',
      '40',
      '--model',
      'claude-sonnet-5',
    ]),
  );
  expect(run?.env).toMatchObject({
    ANTHROPIC_BASE_URL: 'http://model.internal',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  });
}

async function expectKeyOnlyAtEgress(session: Session, sent: readonly Request[]): Promise<void> {
  const placeholder = session.commands[0]?.env['ANTHROPIC_API_KEY'] ?? '';
  const modelCall = new Request('http://model.internal/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': placeholder },
    body: '{}',
  });
  expect((await session.egress(modelCall)).status).toBe(200);
  expect(sent.map((request) => request.url)).toEqual([
    'https://gateway.ai.cloudflare.com/v1/account-1/harness-gateway/anthropic/v1/messages',
  ]);
  expect(sent[0]?.headers.get('x-api-key')).toBe('organization-key');
  expect((await session.egress(new Request('https://api.github.com/user'))).status).toBe(403);
}

async function headless(): Promise<void> {
  const host = fakeContainerHost([reply(result)]);
  const { engine, sent } = engineOn(host);
  expect(await engine.work(work)).toMatchObject({
    outcome: 'ended',
    text: 'Done: the board is built.',
    inputTokens: 1200,
    outputTokens: 340,
    resolvedProvider: 'anthropic',
    resolvedModel: 'claude-sonnet-5',
  });
  const [session] = host.sessions;
  expectHeadlessCommand(session);
  const inside = JSON.stringify(host.sessions);
  for (const secret of ['organization-key', 'gateway-token']) expect(inside).not.toContain(secret);
  if (session === undefined) throw new Error('no session opened');
  await expectKeyOnlyAtEgress(session, sent);
}

async function computeBesideModel(): Promise<void> {
  const host = fakeContainerHost([reply(result)]);
  const { engine } = engineOn(host, { SANDBOX_MINOR_PER_HOUR: '40' });
  const done = await engine.work(work);
  expect(done.costMicros).toBe(432_100);
  expect(done.computeMinor).toBe(30);
  const defaulted = engineOn(fakeContainerHost([reply(result)])).engine;
  expect((await defaulted.work(work)).computeMinor).toBe(8);
  const capped = fakeContainerHost([reply({ ...result, subtype: 'error_max_turns' })]);
  expect((await engineOn(capped).engine.work(work)).outcome).toBe('turn_limit');
}

async function notWired(): Promise<void> {
  const { engine } = engineOn(null);
  await expect(engine.work(work)).rejects.toMatchObject({
    name: 'PortNotWiredError',
    why: 'egress_unavailable',
  });
  const keyless = fakeContainerHost([reply(result)]);
  const { engine: noKey } = engineOn(keyless, { ANTHROPIC_API_KEY: '' });
  await expect(noKey.work(work)).rejects.toMatchObject({ name: 'PortNotWiredError' });
  expect(keyless.sessions).toEqual([]);
}

function modelCall(): Request {
  return new Request('http://model.internal/v1/messages', { method: 'POST', body: '{}' });
}

class Halt extends Error {}

async function everyModelRequestChecked(): Promise<void> {
  const answers: number[] = [];
  let turns = 0;
  const halt = new Halt('the run was stopped');
  const host = fakeContainerHost([
    async (egress) => {
      for (let call = 0; call < 4; call += 1) {
        const response = await egress(modelCall());
        answers.push(response.status);
        if (response.status === 403) expect(await response.text()).toBe('run halted');
      }
      return reply(result);
    },
  ]);
  const { engine, sent } = engineOn(host);
  const onTurn = async () => {
    turns += 1;
    if (turns === 2) throw halt;
  };
  await expect(engine.work({ ...work, onTurn })).rejects.toBe(halt);
  expect(answers).toEqual([200, 403, 403, 403]);
  expect(turns).toBe(2);
  expect(sent).toHaveLength(1);
  expect(host.sessions.map((session) => session.destroyed)).toEqual([true]);
}

async function haltOutranksExecFailure(): Promise<void> {
  const halt = new Halt('the lease lapsed');
  const host = fakeContainerHost([
    async (egress) => {
      expect((await egress(modelCall())).status).toBe(403);
      throw new Error('the container stopped');
    },
  ]);
  const onTurn = () => Promise.reject(halt);
  await expect(engineOn(host).engine.work({ ...work, onTurn })).rejects.toBe(halt);
}

async function failedRunsFail(): Promise<void> {
  const crashed = fakeContainerHost([reply(result, 1)]);
  await expect(engineOn(crashed).engine.work(work)).rejects.toThrow('claude code exited 1');
  const errored = { ...result, subtype: 'error_during_execution', is_error: true, result: null };
  const failing = fakeContainerHost([reply(errored)]);
  await expect(engineOn(failing).engine.work(work)).rejects.toThrow(
    'claude code answered an error',
  );
  const capped = fakeContainerHost([reply({ ...result, subtype: 'error_max_turns' }, 1)]);
  expect((await engineOn(capped).engine.work(work)).outcome).toBe('turn_limit');
}

async function servedModel(): Promise<void> {
  const modelUsage = {
    'claude-haiku-5-20260801': { inputTokens: 40, outputTokens: 12 },
    'claude-sonnet-5-20260901': { inputTokens: 1160, outputTokens: 328 },
  };
  const served = fakeContainerHost([reply({ ...result, modelUsage })]);
  expect((await engineOn(served).engine.work(work)).resolvedModel).toBe('claude-sonnet-5-20260901');
  const unreadable = { 'claude sonnet; rm -rf': { inputTokens: 1, outputTokens: 400 } };
  const odd = fakeContainerHost([reply({ ...result, modelUsage: unreadable })]);
  expect((await engineOn(odd).engine.work(work)).resolvedModel).toBe('claude-sonnet-5');
}

const BUILDER_TOKEN = 'ghs_builder_minted_at_the_host';
const head = 'c'.repeat(40);
const checkout = {
  repository: 'unfoldingWord/uw-platform',
  branch: 'harness/item-1',
  defaultBranch: 'main',
  expectedHead: head,
  fix: false,
};

function pushed(): Request {
  const update = `${'a'.repeat(40)} ${'b'.repeat(40)} refs/heads/harness/item-1\0report-status\n`;
  const body = `${(update.length + 4).toString(16).padStart(4, '0')}${update}0000PACK`;
  return new Request('http://github.internal/unfoldingWord/uw-platform.git/git-receive-pack', {
    method: 'POST',
    body,
  });
}

function expectClone(session: Session | undefined): void {
  const [run] = session?.commands ?? [];
  const script = run?.command[2] ?? '';
  expect(script).toContain('git clone --no-tags "$UW_CLONE_URL" /workspace/repo');
  expect(script).toContain('git -C /workspace/repo checkout -B "$UW_BRANCH" "$UW_START"');
  expect(run?.env).toMatchObject({
    UW_CLONE_URL: 'http://github.internal/unfoldingWord/uw-platform.git',
    UW_BRANCH: 'harness/item-1',
    UW_START: head,
  });
  expect(run?.command.join(' ')).toContain(
    'mcp__uw-platform__read_page,mcp__uw-platform__submit_to_gate,Read,Edit,Write,Glob,Grep,Bash(git *),Bash(curl *)',
  );
  const prompt = session?.files.find((file) => file.path === '/workspace/PROMPT.md')?.content;
  expect(prompt).toContain('git push origin HEAD:refs/heads/harness/item-1');
  expect(prompt).toContain('http://api.github.internal/repos/unfoldingWord/uw-platform/pulls');
}

async function hostedBuilder(): Promise<void> {
  const statuses: number[] = [];
  const host = fakeContainerHost([
    async (egress) => {
      statuses.push((await egress(pushed())).status);
      return reply(result);
    },
  ]);
  const { engine, sent } = engineOn(host);
  const github = { token: async () => BUILDER_TOKEN, unwired: () => undefined };
  const toolset = ['read_page', 'submit_to_gate'] as const;
  await engine.work({ ...work, toolset, checkout, egress: { ...work.egress, github } });
  expect(statuses).toEqual([200]);
  expect(sent.map((request) => request.headers.get('authorization'))).toEqual([
    `Basic ${btoa(`x-access-token:${BUILDER_TOKEN}`)}`,
  ]);
  expectClone(host.sessions[0]);
  expect(JSON.stringify(host.sessions)).not.toContain(BUILDER_TOKEN);
  const fresh = fakeContainerHost([reply(result)]);
  await engineOn(fresh).engine.work({ ...work, checkout: { ...checkout, expectedHead: null } });
  expect(fresh.sessions[0]?.commands[0]?.env['UW_START']).toBe('origin/main');
}

describe('claude-code-sandbox', () => {
  it(
    'PE-5 a hosted Builder clones from the expected head onto harness/<item> with no token in its environment, files or commands',
    hostedBuilder,
  );

  it(
    'a Claude Code session that exits non-zero or answers an error fails the step',
    failedRunsFail,
  );

  it('a Claude Code step records the model the CLI reports it was served', servedModel);

  it('every model request from the sandbox checks the run first, and a halt stops the step', async () => {
    await everyModelRequestChecked();
    await haltOutranksExecFailure();
  });

  it(
    "HE-8 Claude Code runs headless with the persona's toolset as MCP tools and no key in its environment",
    headless,
  );

  it('HE-8 sandbox compute cost is recorded beside model cost', computeBesideModel);

  it('HE-8 without the sandbox binding the engine is not wired', notWired);
});
