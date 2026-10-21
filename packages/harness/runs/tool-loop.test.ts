import type { VerbName } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { ProviderMismatchError, ToolOutsideToolsetError } from '../port-errors.ts';
import type { ToolCall, TurnRequest, TurnResult } from '../ports.ts';
import { runToolLoop, TURN_LIMIT, type ToolCaller, type ToolReply } from './tool-loop.ts';

type Scripted = {
  readonly turn: (request: TurnRequest) => Promise<TurnResult>;
  readonly requests: TurnRequest[];
};

const request = {
  engine: 'openrouter-messages' as const,
  model: 'z-ai/glm-5.3-flash',
  pinnedProvider: 'z-ai',
  persona: 'agent:builder',
  instructions: 'Build the item.',
  tools: ['read_page', 'get_health'] as VerbName[],
  traceId: 'trace-1',
  prompt: 'Work the item.',
};

function call(callId: string, verb: VerbName): ToolCall {
  return { callId, verb, input: { callId } };
}

function result(change: Partial<TurnResult> = {}): TurnResult {
  return {
    toolCalls: [],
    text: 'done',
    stopReason: 'end_turn',
    usage: { inputTokens: 10, outputTokens: 5, costMicros: 100, costBasis: 'metered' },
    resolvedProvider: 'z-ai',
    resolvedModel: 'z-ai/glm-5.3-flash',
    ...change,
  };
}

function scripted(replies: readonly (TurnResult | Error)[]): Scripted {
  const requests: TurnRequest[] = [];
  let index = 0;
  const turn = async (next: TurnRequest): Promise<TurnResult> => {
    requests.push(next);
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    if (reply === undefined) throw new Error('no reply scripted');
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { turn, requests };
}

function recording(answer: (verb: VerbName) => ToolReply | Error): ToolCaller & {
  readonly calls: VerbName[];
} {
  const calls: VerbName[] = [];
  return {
    calls,
    call: async (verb) => {
      calls.push(verb);
      const reply = answer(verb);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
}

function fine(): ToolCaller & { readonly calls: VerbName[] } {
  return recording(() => ({ output: { fine: true }, isError: false }));
}

const noop = async (): Promise<void> => undefined;

async function answersEachCall(): Promise<void> {
  const { turn, requests } = scripted([
    result({ toolCalls: [call('a', 'read_page'), call('b', 'get_health')], text: null }),
    result({ text: 'all done' }),
  ]);
  const tools = recording((verb) => ({ output: { verb }, isError: false }));
  const loop = await runToolLoop(turn, tools, request, noop);
  expect(loop).toMatchObject({ outcome: 'ended', text: 'all done', turns: 2 });
  expect(tools.calls).toEqual(['read_page', 'get_health']);
  expect(requests[0]?.messages).toEqual([{ role: 'user', text: 'Work the item.' }]);
  expect(requests[0]).not.toHaveProperty('prompt');
  expect(requests[1]?.messages).toEqual([
    { role: 'user', text: 'Work the item.' },
    {
      role: 'assistant',
      text: null,
      toolCalls: [call('a', 'read_page'), call('b', 'get_health')],
    },
    { role: 'tool', callId: 'a', verb: 'read_page', output: { verb: 'read_page' }, isError: false },
    {
      role: 'tool',
      callId: 'b',
      verb: 'get_health',
      output: { verb: 'get_health' },
      isError: false,
    },
  ]);
}

async function toolErrorReturned(): Promise<void> {
  const { turn, requests } = scripted([
    result({ toolCalls: [call('a', 'read_page')], text: null }),
    result(),
  ]);
  const tools = recording(() => ({ output: { reason: 'page_not_found' }, isError: true }));
  expect((await runToolLoop(turn, tools, request, noop)).outcome).toBe('ended');
  expect(requests[1]?.messages.at(-1)).toEqual({
    role: 'tool',
    callId: 'a',
    verb: 'read_page',
    output: { reason: 'page_not_found' },
    isError: true,
  });
}

async function toolThrowAnswered(): Promise<void> {
  const { turn, requests } = scripted([
    result({ toolCalls: [call('a', 'read_page')], text: null }),
    result(),
  ]);
  const tools = recording(() => new TypeError('the socket closed with a secret in it'));
  expect((await runToolLoop(turn, tools, request, noop)).outcome).toBe('ended');
  expect(requests[1]?.messages.at(-1)).toEqual({
    role: 'tool',
    callId: 'a',
    verb: 'read_page',
    output: { error: 'TypeError' },
    isError: true,
  });
}

async function stopsAtTurnLimit(): Promise<void> {
  const reading = result({ toolCalls: [call('a', 'read_page')] });
  const last = result({ toolCalls: [call('z', 'get_health')] });
  const { turn, requests } = scripted([...Array.from({ length: 39 }, () => reading), last]);
  const tools = fine();
  let turns = 0;
  const loop = await runToolLoop(turn, tools, request, async () => {
    turns += 1;
  });
  expect(TURN_LIMIT).toBe(40);
  expect(loop).toMatchObject({ outcome: 'turn_limit', text: null, turns: 40 });
  expect(requests).toHaveLength(40);
  expect(turns).toBe(40);
  expect(tools.calls).toEqual(Array.from({ length: 39 }, () => 'read_page'));
  expect(loop.toolsCalled).toEqual(['read_page']);
}

async function providerChangeFails(): Promise<void> {
  const { turn } = scripted([
    result({ toolCalls: [call('a', 'read_page')] }),
    result({ resolvedProvider: 'deepinfra' }),
  ]);
  const failed = runToolLoop(turn, fine(), request, noop);
  await expect(failed).rejects.toBeInstanceOf(ProviderMismatchError);
  await expect(failed).rejects.toMatchObject({ pinned: 'z-ai', resolved: 'deepinfra' });
}

async function usageSummed(): Promise<void> {
  const { turn } = scripted([
    result({ toolCalls: [call('a', 'read_page'), call('b', 'read_page')] }),
    result({ toolCalls: [call('c', 'get_health')] }),
    result({ resolvedModel: 'z-ai/glm-5.3-flash-0930' }),
  ]);
  const loop = await runToolLoop(turn, fine(), request, noop);
  expect(loop.usage).toEqual({ inputTokens: 30, outputTokens: 15, costMicros: 300 });
  expect(loop.toolsCalled).toEqual(['read_page', 'get_health']);
  expect(loop.resolvedProvider).toBe('z-ai');
  expect(loop.resolvedModel).toBe('z-ai/glm-5.3-flash-0930');
}

async function unknownCostIsNull(): Promise<void> {
  const unknown = { inputTokens: 1, outputTokens: 1, costMicros: null, costBasis: 'metered' };
  const { turn } = scripted([
    result({ toolCalls: [call('a', 'read_page')] }),
    result({ usage: { ...unknown, costBasis: 'metered' } }),
  ]);
  expect((await runToolLoop(turn, fine(), request, noop)).usage.costMicros).toBeNull();
}

async function refusalsEndTheLoop(): Promise<void> {
  const outside = scripted([new ToolOutsideToolsetError('merge')]);
  await expect(runToolLoop(outside.turn, fine(), request, noop)).rejects.toBeInstanceOf(
    ToolOutsideToolsetError,
  );
  const tools = recording(() => ({ output: null, isError: false }));
  const stopped = scripted([result({ toolCalls: [call('a', 'read_page')] })]);
  const halt = async () => {
    throw new Error('run_stopped');
  };
  await expect(runToolLoop(stopped.turn, tools, request, halt)).rejects.toThrow('run_stopped');
  expect(tools.calls).toEqual([]);
}

async function engineRefusalEnds(): Promise<void> {
  const tools = fine();
  const refusing = result({
    toolCalls: [call('a', 'read_page')],
    stopReason: 'refused',
    text: 'I cannot help with that.',
  });
  const { turn } = scripted([refusing]);
  const loop = await runToolLoop(turn, tools, request, noop);
  expect(loop.outcome).toBe('refused');
  expect(loop.turns).toBe(1);
  expect(loop.text).toBe('I cannot help with that.');
  expect(tools.calls).toEqual([]);
}

describe('the tool loop', () => {
  it(
    'GD-3 ends refused on a turn the engine refused, and calls no tool after it',
    engineRefusalEnds,
  );

  it(
    'HE-3 the loop answers each tool call with its result and ends on a turn without one',
    answersEachCall,
  );

  it('HE-3 a tool error is returned to the model as the tool result', toolErrorReturned);

  it('HE-3 a tool that throws is answered as an error, not thrown', toolThrowAnswered);

  it('HE-3 the loop stops at 40 turns with turn_limit', stopsAtTurnLimit);

  it(
    'HE-4 a provider that changes between turns fails the loop with ProviderMismatchError',
    providerChangeFails,
  );

  it('HE-3 usage and the tools called are summed across turns', usageSummed);

  it('a turn without a reported cost makes the summed cost unknown', unknownCostIsNull);

  it('a toolset refusal from the turn and a throw from onTurn end the loop', refusalsEndTheLoop);
});
