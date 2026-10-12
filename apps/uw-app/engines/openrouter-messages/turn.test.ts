import { ProviderMismatchError, type TurnRequest } from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { fakeFetch } from '../../testing/engine-fetch.ts';
import stop from '../fixtures/openrouter-stop.json' with { type: 'json' };
import toolCalls from '../fixtures/openrouter-tool-calls.json' with { type: 'json' };
import { openrouterMessagesTurn } from './turn.ts';

const configured = {
  AI_GATEWAY_ACCOUNT_ID: 'account-1',
  AI_GATEWAY_ID: 'harness-gateway',
  OPENROUTER_API_KEY: 'openrouter-key',
};

const request: TurnRequest = {
  engine: 'openrouter-messages',
  model: 'z-ai/glm-5.3-flash',
  pinnedProvider: 'z-ai',
  persona: 'agent:scout',
  instructions: 'Scout the item.',
  tools: ['read_page', 'get_health'],
  messages: [
    { role: 'user', text: 'Check the premise.' },
    {
      role: 'assistant',
      text: 'Looking.',
      toolCalls: [{ callId: 'call_1', verb: 'get_health', input: { harnessId: 'h' } }],
    },
    { role: 'tool', callId: 'call_1', verb: 'get_health', output: { ok: true }, isError: false },
  ],
  traceId: 'trace-1',
};

type SentBody = {
  readonly model: string;
  readonly provider: unknown;
  readonly usage: unknown;
  readonly tool_choice: string;
  readonly tools: readonly { readonly type: string; readonly function: { name: string } }[];
  readonly messages: readonly unknown[];
};

function gatewayWith(reply: unknown, token?: string) {
  const gateway = fakeFetch();
  gateway.respondNext(200, reply);
  const turn = openrouterMessagesTurn({
    ...configured,
    ...(token === undefined ? {} : { AI_GATEWAY_TOKEN: token }),
    fetch: gateway.fetch,
  });
  return { gateway, turn, sent: () => gateway.requests[0]?.body as SentBody };
}

async function pinsProvider(): Promise<void> {
  const { turn, sent } = gatewayWith(toolCalls);
  const result = await turn(request);
  expect(sent().provider).toEqual({ order: ['z-ai'], allow_fallbacks: false });
  expect(sent().usage).toEqual({ include: true });
  expect(sent().tool_choice).toBe('auto');
  expect(sent().tools.map((tool) => tool.function.name)).toEqual(['read_page', 'get_health']);
  expect(sent().messages).toEqual([
    { role: 'system', content: 'Scout the item.' },
    { role: 'user', content: 'Check the premise.' },
    {
      role: 'assistant',
      content: 'Looking.',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'get_health', arguments: '{"harnessId":"h"}' },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
  ]);
  expect(result).toMatchObject({
    resolvedProvider: 'z-ai',
    stopReason: 'tool_use',
    toolCalls: [
      {
        callId: 'call_0_7f3a9c',
        verb: 'read_page',
        input: { pageId: '00000000-0000-4000-8000-000000000001' },
      },
    ],
  });
}

async function otherProvider(): Promise<void> {
  const { turn } = gatewayWith({ ...stop, provider: 'DeepInfra' });
  const failed = turn(request);
  await expect(failed).rejects.toBeInstanceOf(ProviderMismatchError);
  await expect(failed).rejects.toMatchObject({ pinned: 'z-ai', resolved: 'deepinfra' });
}

async function noProvider(): Promise<void> {
  const unnamed = Object.fromEntries(Object.entries(stop).filter(([key]) => key !== 'provider'));
  const failed = gatewayWith(unnamed).turn(request);
  await expect(failed).rejects.toMatchObject({
    name: 'ProviderMismatchError',
    pinned: 'z-ai',
    resolved: null,
  });
  const blank = gatewayWith({ ...stop, provider: '  ' }).turn(request);
  await expect(blank).rejects.toBeInstanceOf(ProviderMismatchError);
}

async function personaModel(): Promise<void> {
  const { turn, sent } = gatewayWith(stop);
  const result = await turn({ ...request, model: 'deepseek/deepseek-v4' });
  expect(sent().model).toBe('deepseek/deepseek-v4');
  expect(result).toMatchObject({ resolvedModel: 'z-ai/glm-5.3-flash', stopReason: 'end_turn' });
  expect(result.text).toContain('harness-scout');
}

async function gatewayPath(): Promise<void> {
  const { gateway, turn } = gatewayWith(stop, 'gateway-token');
  await turn(request);
  const [sent] = gateway.requests;
  expect(sent?.url).toBe(
    'https://gateway.ai.cloudflare.com/v1/account-1/harness-gateway/openrouter/v1/chat/completions',
  );
  expect(sent?.headers['authorization']).toBe('Bearer openrouter-key');
  expect(sent?.headers['cf-aig-authorization']).toBe('Bearer gateway-token');
  const unconfigured = openrouterMessagesTurn({
    ...configured,
    OPENROUTER_API_KEY: undefined,
    fetch: gateway.fetch,
  });
  await expect(unconfigured(request)).rejects.toMatchObject({ name: 'PortNotWiredError' });
}

async function costInMicros(): Promise<void> {
  const { turn } = gatewayWith(toolCalls);
  expect((await turn(request)).usage).toEqual({
    inputTokens: 1312,
    outputTokens: 48,
    costMicros: 420,
    costBasis: 'metered',
  });
  const unpriced = { prompt_tokens: 1404, completion_tokens: 31, total_tokens: 1435 };
  const second = gatewayWith({ ...stop, usage: unpriced });
  expect((await second.turn(request)).usage.costMicros).toBeNull();
}

describe('openrouter-messages', () => {
  it("HE-4 every request pins the persona's provider and refuses fallbacks", pinsProvider);

  it('HE-4 a reply served by another provider fails closed with both names', otherProvider);

  it('HE-4 a reply that names no provider fails closed', noProvider);

  it("HE-4 the model is the persona's model field", personaModel);

  it("HE-4 calls go to AI Gateway's openrouter path", gatewayPath);

  it("the turn's cost comes from OpenRouter's usage in micro-units", costInMicros);
});
