import { describeModelEngineContract } from '@uw/harness/port-contracts/model-engine';
import type { Spend, StopReason, TurnResult } from '@uw/harness';
import { fakeFetch } from '../../testing/engine-fetch.ts';
import toolCalls from '../fixtures/openrouter-tool-calls.json' with { type: 'json' };
import { openrouterMessagesTurn } from './turn.ts';

const finishReasons: ReadonlyMap<StopReason, string> = new Map([
  ['end_turn', 'stop'],
  ['tool_use', 'tool_calls'],
  ['max_tokens', 'length'],
  ['refused', 'content_filter'],
]);

function replyOf(result: TurnResult) {
  const calls = result.toolCalls.map((call, index) => ({
    id: call.callId,
    index,
    type: 'function',
    function: { name: call.verb, arguments: JSON.stringify(call.input) },
  }));
  const message = {
    role: 'assistant',
    content: result.text,
    refusal: null,
    ...(calls.length === 0 ? {} : { tool_calls: calls }),
  };
  const finish = finishReasons.get(result.stopReason);
  const { costMicros } = result.usage;
  return {
    ...toolCalls,
    provider: result.resolvedProvider,
    model: result.resolvedModel,
    choices: [{ index: 0, logprobs: null, finish_reason: finish, message }],
    usage: {
      prompt_tokens: result.usage.inputTokens,
      completion_tokens: result.usage.outputTokens,
      total_tokens: result.usage.inputTokens + result.usage.outputTokens,
      ...(costMicros === null ? {} : { cost: costMicros / 1_000_000 }),
    },
  };
}

describeModelEngineContract('openrouter-messages', async () => {
  const now = new Date('2026-10-03T12:00:00.000Z');
  const gateway = fakeFetch();
  let spent: Pick<Spend, 'spentMinor' | 'currency'> = { spentMinor: 0, currency: 'USD' };
  const turn = openrouterMessagesTurn({
    AI_GATEWAY_ACCOUNT_ID: 'account',
    AI_GATEWAY_ID: 'gateway',
    OPENROUTER_API_KEY: 'test-key',
    fetch: gateway.fetch,
  });
  return {
    engine: { turn, spend: async (since) => ({ ...spent, since, asOf: now }) },
    respondNextWith: async (result) => {
      gateway.respondNext(200, replyOf(result));
    },
    setSpend: async (amount) => {
      spent = amount;
    },
    now: () => now,
  };
});
