import { ProviderMismatchError, ToolOutsideToolsetError, type TurnRequest } from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { fakeFetch } from '../../testing/engine-fetch.ts';
import endTurn from '../fixtures/anthropic-end-turn.json' with { type: 'json' };
import toolUse from '../fixtures/anthropic-tool-use.json' with { type: 'json' };
import { claudeMessagesTurn } from './turn.ts';

const configured = {
  AI_GATEWAY_ACCOUNT_ID: 'account-1',
  AI_GATEWAY_ID: 'harness-gateway',
  ANTHROPIC_API_KEY: 'organization-key',
};

const request: TurnRequest = {
  engine: 'claude-messages',
  model: 'claude-sonnet-4-5',
  pinnedProvider: 'anthropic',
  persona: 'agent:builder',
  instructions: 'Build the item.',
  tools: ['read_page', 'get_health'],
  messages: [
    { role: 'user', text: 'Work the item.' },
    {
      role: 'assistant',
      text: null,
      toolCalls: [{ callId: 'toolu_1', verb: 'get_health', input: { harnessId: 'h' } }],
    },
    { role: 'tool', callId: 'toolu_1', verb: 'get_health', output: { ok: true }, isError: false },
  ],
  traceId: 'trace-1',
};

function gatewayWith(reply: unknown, token?: string) {
  const gateway = fakeFetch();
  gateway.respondNext(200, reply);
  const turn = claudeMessagesTurn({
    ...configured,
    ...(token === undefined ? {} : { AI_GATEWAY_TOKEN: token }),
    fetch: gateway.fetch,
  });
  return { gateway, turn };
}

type SentBody = {
  readonly model: string;
  readonly system: string;
  readonly max_tokens: number;
  readonly tools: readonly { readonly name: string; readonly input_schema: { type: string } }[];
  readonly messages: readonly { readonly role: string; readonly content: unknown }[];
};

async function gatewayPath(): Promise<void> {
  const { gateway, turn } = gatewayWith(endTurn, 'gateway-token');
  const result = await turn(request);
  const [sent] = gateway.requests;
  expect(sent?.url).toBe(
    'https://gateway.ai.cloudflare.com/v1/account-1/harness-gateway/anthropic/v1/messages',
  );
  expect(sent?.method).toBe('POST');
  expect(sent?.headers['x-api-key']).toBe('organization-key');
  expect(sent?.headers['cf-aig-authorization']).toBe('Bearer gateway-token');
  expect(result).toMatchObject({
    text: 'The page is read and the work is done.',
    stopReason: 'end_turn',
    resolvedProvider: 'anthropic',
    resolvedModel: 'claude-sonnet-4-5',
    usage: { inputTokens: 610, outputTokens: 24, costMicros: 610 * 3 + 24 * 15 },
  });
  expect(result.usage.costBasis).toBe('metered');
}

async function toolsOffered(): Promise<void> {
  const { gateway, turn } = gatewayWith(toolUse);
  const result = await turn(request);
  const body = gateway.requests[0]?.body as SentBody;
  expect(body.tools.map((tool) => tool.name)).toEqual(['read_page', 'get_health']);
  expect(body.tools.every((tool) => tool.input_schema.type === 'object')).toBe(true);
  expect(body).toMatchObject({ model: 'claude-sonnet-4-5', system: 'Build the item.' });
  expect(body.max_tokens).toBe(4096);
  expect(body.messages).toEqual([
    { role: 'user', content: 'Work the item.' },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_health', input: { harnessId: 'h' } }],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}', is_error: false },
      ],
    },
  ]);
  expect(result.toolCalls).toEqual([
    {
      callId: 'toolu_01A09q90qw90lq917835lq9',
      verb: 'read_page',
      input: { pageId: '00000000-0000-4000-8000-000000000001' },
    },
  ]);
}

async function outsideRefused(): Promise<void> {
  const { turn } = gatewayWith(toolUse);
  await expect(turn({ ...request, tools: ['get_health'] })).rejects.toBeInstanceOf(
    ToolOutsideToolsetError,
  );
  const unknown = {
    ...toolUse,
    content: [{ type: 'tool_use', id: 't', name: 'merge', input: {} }],
  };
  await expect(gatewayWith(unknown).turn(request)).rejects.toMatchObject({ verb: 'merge' });
}

async function otherPin(): Promise<void> {
  const { gateway, turn } = gatewayWith(endTurn);
  const failed = turn({ ...request, pinnedProvider: 'openai' });
  await expect(failed).rejects.toBeInstanceOf(ProviderMismatchError);
  await expect(failed).rejects.toMatchObject({ pinned: 'openai', resolved: 'anthropic' });
  expect(gateway.requests).toEqual([]);
}

async function noKey(): Promise<void> {
  const settings = [
    { ...configured, ANTHROPIC_API_KEY: undefined },
    { ...configured, AI_GATEWAY_ID: undefined },
    { ...configured, AI_GATEWAY_ACCOUNT_ID: undefined },
  ];
  for (const setting of settings) {
    const gateway = fakeFetch();
    const turn = claudeMessagesTurn({ ...setting, fetch: gateway.fetch });
    await expect(turn(request)).rejects.toMatchObject({
      name: 'PortNotWiredError',
      method: 'turn',
    });
    expect(gateway.requests).toEqual([]);
  }
}

describe('claude-messages', () => {
  it("HE-3 calls go to AI Gateway's anthropic path with the organization key", gatewayPath);

  it(
    "HE-3 the tools offered are exactly the request's toolset with each verb's schema",
    toolsOffered,
  );

  it('HE-3 a reply calling a verb outside the toolset is refused', outsideRefused);

  it('HE-4 a pin other than anthropic fails closed', otherPin);

  it('HE-3 an engine with no key answers not_wired', noKey);

  it('a model with no known price reports its cost as unknown', async () => {
    const { turn } = gatewayWith({ ...endTurn, model: 'claude-unpriced-9' });
    expect((await turn(request)).usage.costMicros).toBeNull();
  });
});
