import type { AssistantEffectRow, AssistantRequestRow, TurnMessage } from '../ports.ts';

export const HISTORY_PAIRS = 6;
export const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const REPLY_KEY_PREFIX = 'reply:';

export function replyKeyOf(requestId: string): string {
  return `${REPLY_KEY_PREFIX}${requestId}`;
}

function replyTexts(effects: readonly AssistantEffectRow[]): ReadonlyMap<string, string> {
  const texts = new Map<string, string>();
  for (const effect of effects) {
    const text = effect.payload['text'];
    const replied = effect.kind === 'reply_to_requester' && typeof text === 'string';
    if (replied && effect.idempotencyKey === replyKeyOf(effect.requestId)) {
      texts.set(effect.requestId, text);
    }
  }
  return texts;
}

function sameThread(request: AssistantRequestRow, current: AssistantRequestRow): boolean {
  return request.channel === current.channel && request.threadKey === current.threadKey;
}

function precedes(request: AssistantRequestRow, current: AssistantRequestRow): boolean {
  const age = current.recordedAt.getTime() - request.recordedAt.getTime();
  return age > 0 || (age === 0 && request.id < current.id);
}

function inWindow(request: AssistantRequestRow, current: AssistantRequestRow): boolean {
  const age = current.recordedAt.getTime() - request.recordedAt.getTime();
  return sameThread(request, current) && precedes(request, current) && age <= HISTORY_WINDOW_MS;
}

function byPlace(a: AssistantRequestRow, b: AssistantRequestRow): number {
  const age = a.recordedAt.getTime() - b.recordedAt.getTime();
  if (age !== 0) return age;
  return a.id < b.id ? -1 : 1;
}

export function historyOf(
  current: AssistantRequestRow,
  requests: readonly AssistantRequestRow[],
  effects: readonly AssistantEffectRow[],
): readonly TurnMessage[] {
  if (current.threadKey === null) return [];
  const texts = replyTexts(effects);
  const pairs = [...requests]
    .filter((request) => inWindow(request, current) && texts.has(request.id))
    .sort(byPlace)
    .slice(-HISTORY_PAIRS);
  return pairs.flatMap((request): TurnMessage[] => [
    { role: 'user', text: request.note },
    { role: 'assistant', text: texts.get(request.id) ?? '', toolCalls: [] },
  ]);
}
