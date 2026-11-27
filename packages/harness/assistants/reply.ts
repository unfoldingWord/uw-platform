import type { AssistantTurnOutcome, VerbName } from '@uw/contracts';
import { draft, type EventDraft } from '../items/record.ts';
import type { LoopResult } from '../runs/tool-loop.ts';

export const REPLY_LIMIT = 8_000;
export const NO_ANSWER =
  'I could not finish an answer to this request. Please ask again, or ask in a different way.';
export const REFUSED_ANSWER = 'I cannot help with this request.';

export type SettledLoop = Omit<LoopResult, 'outcome'> & {
  readonly outcome: AssistantTurnOutcome;
};

const TOOLS_MOST = 100;

const ENDS_IN_HIGH_SURROGATE = /[\uD800-\uDBFF]$/;

function bounded(text: string): string {
  if (text.length <= REPLY_LIMIT) return text;
  const cut = text.slice(0, REPLY_LIMIT);
  return ENDS_IN_HIGH_SURROGATE.test(cut) ? cut.slice(0, -1) : cut;
}

export function replyTextOf(result: SettledLoop): string {
  if (result.outcome === 'refused') return REFUSED_ANSWER;
  const text = result.outcome === 'ended' ? (result.text ?? '').trim() : '';
  return text === '' ? NO_ANSWER : bounded(text);
}

function count(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function micros(value: number | null): number | null {
  return value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function distinctTools(tools: readonly VerbName[]): VerbName[] {
  return [...new Set(tools)].slice(0, TOOLS_MOST);
}

export function finishedDraft(input: {
  readonly requestId: string;
  readonly turnId: string;
  readonly result: SettledLoop;
}): EventDraft {
  const { result } = input;
  return draft('assistant_turn_finished', {
    requestId: input.requestId,
    turnId: input.turnId,
    outcome: result.outcome,
    turns: count(result.turns),
    inputTokens: count(result.usage.inputTokens),
    outputTokens: count(result.usage.outputTokens),
    costMicros: micros(result.usage.costMicros),
    tools: distinctTools(result.toolsCalled),
  });
}
