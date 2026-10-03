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
  tools: { call: () => Promise.reject(new Error('the sandbox calls tools over MCP')) },
  onTurn: async () => undefined,
  egress: {
    mcp: async () => Response.json({ jsonrpc: '2.0', id: 1, result: {} }),
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

function reply(body: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(body), stderr: '' };
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

describe('claude-code-sandbox', () => {
  it('HE-8 every model request from the sandbox checks the run first, and a halt stops the step', async () => {
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
