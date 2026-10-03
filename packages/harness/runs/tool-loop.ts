import type { VerbName } from '@uw/contracts';
import { ProviderMismatchError } from '../port-errors.ts';
import type { ModelEngine, ToolCall, TurnMessage, TurnRequest, TurnResult } from '../ports.ts';

export const TURN_LIMIT = 40;

export type ToolReply = { readonly output: unknown; readonly isError: boolean };
export type ToolCaller = { call(verb: VerbName, input: unknown): Promise<ToolReply> };

type LoopRequest = Omit<TurnRequest, 'messages'> & { readonly prompt: string };
type LoopUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicros: number | null;
};
export type LoopResult = {
  readonly outcome: 'ended' | 'turn_limit';
  readonly text: string | null;
  readonly usage: LoopUsage;
  readonly resolvedProvider: string | null;
  readonly resolvedModel: string;
  readonly toolsCalled: readonly VerbName[];
  readonly turns: number;
};

type Tally = {
  usage: LoopUsage;
  provider: string | null;
  model: string;
  readonly tools: VerbName[];
  turns: number;
};

async function answer(tools: ToolCaller, call: ToolCall): Promise<TurnMessage> {
  const base = { role: 'tool' as const, callId: call.callId, verb: call.verb };
  try {
    const reply = await tools.call(call.verb, call.input);
    return { ...base, output: reply.output, isError: reply.isError };
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    return { ...base, output: { error: name }, isError: true };
  }
}

function summed(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a + b;
}

function counted(tally: Tally, result: TurnResult): void {
  if (tally.turns > 0 && result.resolvedProvider !== tally.provider) {
    throw new ProviderMismatchError(tally.provider ?? 'none', result.resolvedProvider);
  }
  if (tally.turns === 0) tally.provider = result.resolvedProvider;
  tally.turns += 1;
  tally.model = result.resolvedModel;
  const { usage } = tally;
  tally.usage = {
    inputTokens: usage.inputTokens + result.usage.inputTokens,
    outputTokens: usage.outputTokens + result.usage.outputTokens,
    costMicros: summed(usage.costMicros, result.usage.costMicros),
  };
  for (const call of result.toolCalls) {
    if (!tally.tools.includes(call.verb)) tally.tools.push(call.verb);
  }
}

function finished(tally: Tally, outcome: LoopResult['outcome'], text: string | null): LoopResult {
  return {
    outcome,
    text,
    usage: tally.usage,
    resolvedProvider: tally.provider,
    resolvedModel: tally.model,
    toolsCalled: [...tally.tools],
    turns: tally.turns,
  };
}

export async function runToolLoop(
  turn: ModelEngine['turn'],
  tools: ToolCaller,
  request: LoopRequest,
  onTurn: () => Promise<void>,
): Promise<LoopResult> {
  const { prompt, ...rest } = request;
  const messages: TurnMessage[] = [{ role: 'user', text: prompt }];
  const usage = { inputTokens: 0, outputTokens: 0, costMicros: 0 };
  const tally: Tally = { usage, provider: null, model: request.model, tools: [], turns: 0 };
  while (tally.turns < TURN_LIMIT) {
    const result = await turn({ ...rest, messages: [...messages] });
    counted(tally, result);
    await onTurn();
    if (result.toolCalls.length === 0) return finished(tally, 'ended', result.text);
    messages.push({ role: 'assistant', text: result.text, toolCalls: result.toolCalls });
    for (const call of result.toolCalls) messages.push(await answer(tools, call));
  }
  return finished(tally, 'turn_limit', null);
}
