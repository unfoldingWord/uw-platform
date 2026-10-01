import { describe, expect, it } from 'vitest';
import type { ModelEngine, ToolCall, TurnRequest, TurnResult } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

export type ModelEngineSubject = {
  readonly engine: ModelEngine;
  respondNextWith(result: TurnResult): Promise<void>;
};

const turnRequest: TurnRequest = {
  engine: 'openrouter-messages',
  model: 'fixture-model',
  pinnedProvider: null,
  persona: 'builder',
  instructions: 'model engine contract fixture',
  tools: ['read_page', 'claim_item'],
  messages: [{ role: 'user', text: 'begin' }],
  traceId: 'b2000000-0000-4000-8000-000000000001',
};

function callOf(verb: ToolCall['verb']): ToolCall {
  return { callId: 'call-1', verb, input: {} };
}

function turnCalling(verb: ToolCall['verb']): TurnResult {
  return {
    toolCalls: [callOf(verb)],
    text: null,
    stopReason: 'tool_use',
    usage: { inputTokens: 120, outputTokens: 30, costMinor: 1, costBasis: 'metered' },
    resolvedProvider: 'fixture-provider',
    resolvedModel: 'fixture-model',
  };
}

function afterToolRound(): TurnRequest {
  return {
    ...turnRequest,
    messages: [
      { role: 'user', text: 'begin' },
      { role: 'assistant', text: null, toolCalls: [callOf('claim_item')] },
      {
        role: 'tool',
        callId: 'call-1',
        verb: 'claim_item',
        output: { claimed: true },
        isError: false,
      },
    ],
  };
}

function describeToolset(open: () => Promise<ModelEngineSubject>): void {
  it('returns the tool calls of a turn that stays inside the offered toolset', async () => {
    const subject = await open();
    await subject.respondNextWith(turnCalling('claim_item'));
    expect((await subject.engine.turn(turnRequest)).toolCalls.map((call) => call.verb)).toEqual([
      'claim_item',
    ]);
  });

  it('rejects a turn that calls a verb outside the toolset, naming the verb', async () => {
    const subject = await open();
    await subject.respondNextWith(turnCalling('write_page'));
    await expect(subject.engine.turn(turnRequest)).rejects.toMatchObject({
      name: 'ToolOutsideToolsetError',
      verb: 'write_page',
    });
  });
}

function describeReporting(open: () => Promise<ModelEngineSubject>): void {
  it('reports usage as non-negative whole numbers with a cost basis', async () => {
    const subject = await open();
    await subject.respondNextWith(turnCalling('read_page'));
    const { usage } = await subject.engine.turn(turnRequest);
    expect(Number.isInteger(usage.inputTokens) && usage.inputTokens >= 0).toBe(true);
    expect(Number.isInteger(usage.outputTokens) && usage.outputTokens >= 0).toBe(true);
    expect(['metered', 'subscription']).toContain(usage.costBasis);
  });

  it('reports the provider and model that served the turn and why it stopped', async () => {
    const subject = await open();
    await subject.respondNextWith(turnCalling('read_page'));
    const result = await subject.engine.turn({
      ...turnRequest,
      pinnedProvider: 'fixture-provider',
    });
    expect(result).toMatchObject({
      resolvedProvider: 'fixture-provider',
      resolvedModel: 'fixture-model',
      stopReason: 'tool_use',
    });
  });

  it('takes a turn whose history replays an earlier turn tool calls and their results', async () => {
    const subject = await open();
    await subject.respondNextWith({
      ...turnCalling('read_page'),
      toolCalls: [],
      stopReason: 'end_turn',
    });
    const result = await subject.engine.turn(afterToolRound());
    expect(result.stopReason).toBe('end_turn');
  });
}

export function describeModelEngineContract(
  adapter: string,
  open: () => Promise<ModelEngineSubject>,
): void {
  describe(`DX-3 modelEngine port contract on ${adapter}`, () => {
    describeToolset(open);
    describeReporting(open);
  });
}

export function describeModelEngineNotWired(adapter: string, engine: ModelEngine): void {
  describeNotWired('modelEngine', adapter, engine, { turn: true } satisfies Record<
    keyof ModelEngine,
    true
  >);
}
