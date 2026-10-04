import { describe, expect, it } from 'vitest';
import { fakeContainerHost, type FakeContainerHost } from '../sandbox/testing.ts';
import type { EngineWork } from '../seam.ts';
import { codexSandboxEngine } from './index.ts';

const keys = {
  AI_GATEWAY_ACCOUNT_ID: 'account-1',
  AI_GATEWAY_ID: 'harness-gateway',
  AI_GATEWAY_TOKEN: 'gateway-token',
  OPENAI_API_KEY: 'organization-openai-key',
};

const work: EngineWork = {
  runId: 'run-2',
  itemId: 'item-2',
  traceId: 'trace-2',
  persona: 'agent:reviewer-codex',
  model: 'gpt-5.5-codex',
  pinnedProvider: 'openai',
  instructions: 'You review the pull request.',
  prompt: 'Review the diff.',
  toolset: ['read_page', 'search_pages'],
  checkout: null,
  tools: { call: () => Promise.reject(new Error('the sandbox calls tools over MCP')) },
  onTurn: async () => undefined,
  egress: {
    mcp: async () => Response.json({ jsonrpc: '2.0', id: 1, result: {} }),
    github: null,
    refused: () => undefined,
  },
};

const verdict = '```harness-verdict\nverdict: approve\n```\n- The change is small.';

const events = [
  { type: 'thread.started', thread_id: 't-1' },
  { msg: { type: 'agent_message', message: 'Reading the diff.' } },
  { msg: { type: 'token_count', input_tokens: 900, output_tokens: 120 } },
  { type: 'item.completed', item: { type: 'agent_message', text: verdict } },
  { type: 'turn.completed', usage: { input_tokens: 400, output_tokens: 60 } },
];

function reply(lines: readonly unknown[], exitCode = 0) {
  const stdout = `${lines.map((line) => JSON.stringify(line)).join('\n')}\nnot json\n`;
  return { exitCode, stdout, stderr: '' };
}

function engineOn(host: FakeContainerHost | null) {
  const sent: Request[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    sent.push(new Request(input, init));
    return Response.json({ ok: true });
  };
  const sandboxes = { claudeCode: null, codex: host };
  const clock = [0, 6 * 60_000];
  let index = 0;
  const now = () => new Date(clock[Math.min(index++, 1)] ?? 0);
  return { engine: codexSandboxEngine({ ...keys, fetch, sandboxes, now }), sent };
}

type Session = FakeContainerHost['sessions'][number];

async function expectKeyOnlyAtEgress(session: Session, sent: readonly Request[]): Promise<void> {
  const call = new Request('http://model.internal/responses', { method: 'POST', body: '{}' });
  expect((await session.egress(call)).status).toBe(200);
  expect(sent.map((request) => request.url)).toEqual([
    'https://gateway.ai.cloudflare.com/v1/account-1/harness-gateway/openai/responses',
  ]);
  expect(sent[0]?.headers.get('authorization')).toBe('Bearer organization-openai-key');
}

async function ownContainer(): Promise<void> {
  const host = fakeContainerHost([reply(events)]);
  const { engine, sent } = engineOn(host);
  expect(await engine.work(work)).toMatchObject({
    outcome: 'ended',
    text: verdict,
    inputTokens: 1300,
    outputTokens: 180,
    costMicros: null,
    computeMinor: 1,
    resolvedProvider: 'openai',
    resolvedModel: 'gpt-5.5-codex',
  });
  const [session] = host.sessions;
  const config = session?.files.find((file) => file.path === '/workspace/.codex/config.toml');
  expect(config?.content).toContain('model = "gpt-5.5-codex"');
  expect(config?.content).toContain('[mcp_servers.uw-platform]\nurl = "http://mcp.internal/mcp"');
  expect(config?.content).toContain('base_url = "http://model.internal"');
  expect(session?.commands[0]?.command.join(' ')).toContain(
    'codex exec --json --skip-git-repo-check --cd /workspace',
  );
  const inside = JSON.stringify(host.sessions);
  for (const secret of ['organization-openai-key', 'gateway-token']) {
    expect(inside).not.toContain(secret);
  }
  if (session === undefined) throw new Error('no session opened');
  await expectKeyOnlyAtEgress(session, sent);
}

async function noStateKept(): Promise<void> {
  const host = fakeContainerHost([reply(events), new Error('the container stopped')]);
  const { engine } = engineOn(host);
  await engine.work(work);
  await expect(engine.work(work)).rejects.toThrow('the container stopped');
  expect(host.sessions.map((session) => session.destroyed)).toEqual([true, true]);
  const [first, second] = host.sessions.map((session) => session.id);
  expect(first).not.toBe(second);
  const silent = fakeContainerHost([reply([])]);
  await expect(engineOn(silent).engine.work(work)).rejects.toThrow('codex answered no message');
  expect(silent.sessions.map((session) => session.destroyed)).toEqual([true]);
}

async function crashFails(): Promise<void> {
  const crashed = fakeContainerHost([reply(events.slice(0, 3), 1)]);
  await expect(engineOn(crashed).engine.work(work)).rejects.toThrow('codex exited 1');
  expect(crashed.sessions.map((session) => session.destroyed)).toEqual([true]);
}

describe('codex-sandbox', () => {
  it(
    'HE-9 Codex runs in its own container with the toolset as MCP tools and no key in its environment',
    ownContainer,
  );

  it('HE-9 the container holds no state after the step', noStateKept);

  it(
    'a Codex session that exits non-zero fails the step, even after an earlier message',
    crashFails,
  );
});
