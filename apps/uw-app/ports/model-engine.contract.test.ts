import { describeModelEngineContract } from '@uw/harness/port-contracts/model-engine';
import {
  ProviderMismatchError,
  ToolOutsideToolsetError,
  type Spend,
  type TurnRequest,
  type TurnResult,
} from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { engineRegistryOf } from '../engines/registry.ts';
import { platformModelEngine, spendNotWired } from './model-engine.ts';

const config = { fetch: () => Promise.reject(new Error('no network in tests')) };

function answered(request: TurnRequest): void {
  const called = new Set<string>();
  for (const message of request.messages) {
    if (message.role === 'assistant') message.toolCalls.forEach((call) => called.add(call.callId));
    if (message.role === 'tool' && !called.has(message.callId)) {
      throw new Error(`tool result ${message.callId} answers no earlier tool call`);
    }
  }
}

function scriptedTurn(script: TurnResult[]) {
  return async (request: TurnRequest): Promise<TurnResult> => {
    answered(request);
    const result = script.shift();
    if (result === undefined) throw new Error('no turn scripted');
    const pinned = request.pinnedProvider;
    if (pinned !== null && result.resolvedProvider !== pinned) {
      throw new ProviderMismatchError(pinned, result.resolvedProvider);
    }
    const outside = result.toolCalls.find((call) => !request.tools.includes(call.verb));
    if (outside) throw new ToolOutsideToolsetError(outside.verb);
    return result;
  };
}

describeModelEngineContract('platform', async () => {
  const now = new Date('2026-10-03T12:00:00.000Z');
  const script: TurnResult[] = [];
  let spent: Pick<Spend, 'spentMinor' | 'currency'> = { spentMinor: 0, currency: 'USD' };
  const registry = new Map(engineRegistryOf(config));
  const openrouter = registry.get('openrouter-messages');
  if (openrouter === undefined) throw new Error('no openrouter-messages engine');
  registry.set('openrouter-messages', { ...openrouter, turn: scriptedTurn(script) });
  const engine = platformModelEngine(registry, async (since) => ({ ...spent, since, asOf: now }));
  return {
    engine,
    respondNextWith: async (result) => {
      script.push(result);
    },
    setSpend: async (amount) => {
      spent = amount;
    },
    now: () => now,
  };
});

describe('the platform model engine before an engine is configured', () => {
  const engine = platformModelEngine(engineRegistryOf(config), spendNotWired);
  const request: TurnRequest = {
    engine: 'claude-messages',
    model: 'model',
    pinnedProvider: null,
    persona: 'agent:builder',
    instructions: 'Work.',
    tools: [],
    messages: [{ role: 'user', text: 'Begin.' }],
    traceId: 'trace-1',
  };

  it.each(['claude-messages', 'openrouter-messages'] as const)(
    'a turn on %s with no configuration rejects with PortNotWiredError',
    async (key) => {
      await expect(engine.turn({ ...request, engine: key })).rejects.toMatchObject({
        name: 'PortNotWiredError',
        port: 'modelEngine',
        method: 'turn',
      });
    },
  );

  it('a spend with no reader rejects with PortNotWiredError', async () => {
    await expect(engine.spend(new Date())).rejects.toMatchObject({
      name: 'PortNotWiredError',
      port: 'modelEngine',
      method: 'spend',
    });
  });

  it.each(['claude-code-sandbox', 'codex-sandbox'] as const)(
    'a turn on %s, which is not turn-based, rejects with EngineNotAvailableError',
    async (key) => {
      await expect(engine.turn({ ...request, engine: key })).rejects.toMatchObject({
        name: 'EngineNotAvailableError',
        engine: key,
      });
    },
  );
});
