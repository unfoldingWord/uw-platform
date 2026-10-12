import { describeModelEngineContract } from '@uw/harness/port-contracts/model-engine';
import type { Spend, StopReason, TurnResult } from '@uw/harness';
import { fakeFetch } from '../../testing/engine-fetch.ts';
import toolUse from '../fixtures/anthropic-tool-use.json' with { type: 'json' };
import { claudeMessagesTurn } from './turn.ts';

const stopReasons: ReadonlyMap<StopReason, string> = new Map([
  ['end_turn', 'end_turn'],
  ['tool_use', 'tool_use'],
  ['max_tokens', 'max_tokens'],
  ['refused', 'refusal'],
]);

function replyOf(result: TurnResult) {
  const text = result.text === null ? [] : [{ type: 'text', text: result.text }];
  const calls = result.toolCalls.map((call) => ({
    type: 'tool_use',
    id: call.callId,
    name: call.verb,
    input: call.input,
  }));
  return {
    ...toolUse,
    model: result.resolvedModel,
    content: [...text, ...calls],
    stop_reason: stopReasons.get(result.stopReason),
    usage: { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
  };
}

describeModelEngineContract('claude-messages', async () => {
  const now = new Date('2026-10-03T12:00:00.000Z');
  const gateway = fakeFetch();
  let spent: Pick<Spend, 'spentMinor' | 'currency'> = { spentMinor: 0, currency: 'USD' };
  const turn = claudeMessagesTurn({
    AI_GATEWAY_ACCOUNT_ID: 'account',
    AI_GATEWAY_ID: 'gateway',
    ANTHROPIC_API_KEY: 'test-key',
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
    servedBy: 'anthropic',
  };
});
