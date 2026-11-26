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

function inWindow(request: AssistantRequestRow, current: AssistantRequestRow): boolean {
  if (request.id === current.id || request.threadKey !== current.threadKey) return false;
  const age = current.recordedAt.getTime() - request.recordedAt.getTime();
  return age >= 0 && age <= HISTORY_WINDOW_MS;
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
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())
    .slice(-HISTORY_PAIRS);
  return pairs.flatMap((request): TurnMessage[] => [
    { role: 'user', text: request.note },
    { role: 'assistant', text: texts.get(request.id) ?? '', toolCalls: [] },
  ]);
}
