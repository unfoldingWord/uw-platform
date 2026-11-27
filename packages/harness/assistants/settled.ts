import type { AssistantEffectRow, AssistantRequestRow, StoreTransaction } from '../ports.ts';
import { effectEvents } from './ledger.ts';

const REPLY = 'reply_to_requester';

export async function unsettledDrafts(
  tx: StoreTransaction,
  request: AssistantRequestRow,
): Promise<readonly AssistantEffectRow[]> {
  const drafts = (await tx.assistantEffects.read.forRequests([request.id])).filter(
    (effect) => effect.requestId === request.id && effect.kind !== REPLY,
  );
  const open: AssistantEffectRow[] = [];
  for (const effect of drafts) {
    const settled = await effectEvents(tx, request, effect.id, [
      'assistant_effect_done',
      'assistant_effect_failed',
    ]);
    if (settled.length === 0) open.push(effect);
  }
  return open;
}
