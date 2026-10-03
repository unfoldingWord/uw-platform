import { describe, expect, it } from 'vitest';
import type { ModelEngine, Spend, ToolCall, TurnRequest, TurnResult } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

export type ModelEngineSubject = {
  readonly engine: ModelEngine;
  respondNextWith(result: TurnResult): Promise<void>;
  setSpend(amount: Pick<Spend, 'spentMinor' | 'currency'>): Promise<void>;
  now(): Date;
};

const dayMs = 86_400_000;

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
    usage: { inputTokens: 120, outputTokens: 30, costMicros: 10_000, costBasis: 'metered' },
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
  it('reports usage as non-negative whole numbers, cost in micro-units or null, and a cost basis', async () => {
    const subject = await open();
    await subject.respondNextWith(turnCalling('read_page'));
    const { usage } = await subject.engine.turn(turnRequest);
    expect(Number.isInteger(usage.inputTokens) && usage.inputTokens >= 0).toBe(true);
    expect(Number.isInteger(usage.outputTokens) && usage.outputTokens >= 0).toBe(true);
    expect(['metered', 'subscription']).toContain(usage.costBasis);
    const micros = usage.costMicros;
    expect(micros === null || (Number.isSafeInteger(micros) && micros >= 0)).toBe(true);
  });

  it('reports a turn whose cost is unknown with null micro-units, never zero', async () => {
    const subject = await open();
    const scripted = turnCalling('read_page');
    await subject.respondNextWith({ ...scripted, usage: { ...scripted.usage, costMicros: null } });
    expect((await subject.engine.turn(turnRequest)).usage.costMicros).toBeNull();
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

function describePinning(open: () => Promise<ModelEngineSubject>): void {
  it('reports the pinned provider when the turn was served by it', async () => {
    const subject = await open();
    await subject.respondNextWith(turnCalling('read_page'));
    const result = await subject.engine.turn({
      ...turnRequest,
      pinnedProvider: 'fixture-provider',
    });
    expect(result.resolvedProvider).toBe('fixture-provider');
  });

  it('rejects with both provider names when another provider served a pinned turn', async () => {
    const subject = await open();
    await subject.respondNextWith(turnCalling('read_page'));
    await expect(
      subject.engine.turn({ ...turnRequest, pinnedProvider: 'pinned-provider' }),
    ).rejects.toMatchObject({
      name: 'ProviderMismatchError',
      pinned: 'pinned-provider',
      resolved: 'fixture-provider',
    });
  });

  it('reports whichever provider served an unpinned turn', async () => {
    const subject = await open();
    await subject.respondNextWith({
      ...turnCalling('read_page'),
      resolvedProvider: 'other-provider',
    });
    const result = await subject.engine.turn(turnRequest);
    expect(result.resolvedProvider).toBe('other-provider');
  });

  it('rejects a history whose tool result answers no earlier tool call', async () => {
    const subject = await open();
    const orphan: TurnRequest = {
      ...turnRequest,
      messages: [
        { role: 'user', text: 'begin' },
        { role: 'tool', callId: 'call-9', verb: 'claim_item', output: {}, isError: false },
      ],
    };
    await expect(subject.engine.turn(orphan)).rejects.toThrow('call-9');
  });
}

function describeSpend(open: () => Promise<ModelEngineSubject>): void {
  it('answers spend as whole minor units in a three-letter currency, read at or after since', async () => {
    const subject = await open();
    await subject.setSpend({ spentMinor: 4321, currency: 'USD' });
    const since = new Date(subject.now().getTime() - dayMs);
    const reading = await subject.engine.spend(since);
    expect(reading).toMatchObject({ spentMinor: 4321, currency: 'USD', since });
    expect(Number.isSafeInteger(reading.spentMinor)).toBe(true);
    expect(reading.currency).toMatch(/^[A-Z]{3}$/u);
    expect(reading.asOf.getTime()).toBeGreaterThanOrEqual(since.getTime());
    expect(reading.asOf.getTime()).toBeLessThanOrEqual(subject.now().getTime());
  });

  it('answers zero spend as a reading that names when it was read', async () => {
    const subject = await open();
    await subject.setSpend({ spentMinor: 0, currency: 'USD' });
    const since = new Date(subject.now().getTime() - dayMs);
    const reading = await subject.engine.spend(since);
    expect(reading.spentMinor).toBe(0);
    expect(Number.isNaN(reading.asOf.getTime())).toBe(false);
    expect(reading.asOf.getTime()).toBeGreaterThanOrEqual(since.getTime());
    expect(reading.asOf.getTime()).toBeLessThanOrEqual(subject.now().getTime());
  });
}

export function describeModelEngineContract(
  adapter: string,
  open: () => Promise<ModelEngineSubject>,
): void {
  describe(`DX-3 modelEngine port contract on ${adapter}`, () => {
    describeToolset(open);
    describeReporting(open);
    describePinning(open);
    describeSpend(open);
  });
}

export function describeModelEngineNotWired(adapter: string, engine: ModelEngine): void {
  describeNotWired('modelEngine', adapter, engine, { turn: true, spend: true } satisfies Record<
    keyof ModelEngine,
    true
  >);
}
