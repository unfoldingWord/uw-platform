import { ZULIP_TEXT_LIMIT, type HarnessEvent } from '@uw/contracts';
import { isIngestPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import {
  draft,
  recordContext,
  recordHarnessEvents,
  recordItemEvents,
  type EventDraft,
  type RecordContext,
} from './record.ts';

type CommentPorts = Pick<Ports, 'clock' | 'ids' | 'store'>;

export type CommentInput = {
  readonly harnessId: string;
  readonly itemId: string | null;
  readonly messageId: number;
  readonly topic: string;
  readonly personId: string | null;
  readonly email: string;
  readonly text: string;
};

export type Commented = { readonly eventId: string };

function commentDraft(input: CommentInput): EventDraft {
  const truncated = input.text.length > ZULIP_TEXT_LIMIT;
  return draft('comment_recorded', {
    source: 'zulip',
    messageId: input.messageId,
    topic: input.topic,
    personId: input.personId,
    email: input.email,
    text: truncated ? input.text.slice(0, ZULIP_TEXT_LIMIT) : input.text,
    truncated,
  });
}

async function appended(
  tx: StoreTransaction,
  context: RecordContext,
  input: CommentInput,
): Promise<readonly HarnessEvent[] | null> {
  const comment = [commentDraft(input)];
  if (input.itemId === null) {
    return recordHarnessEvents(tx, context, input.harnessId, comment);
  }
  const item = await tx.harnessItems.read.lock(input.itemId);
  if (item === null || item.harnessId !== input.harnessId) return null;
  return (await recordItemEvents(tx, context, item.itemId, comment)).events;
}

export async function recordComment(
  ports: CommentPorts,
  caller: Caller,
  input: CommentInput,
): Promise<KernelOutcome<Commented>> {
  if (!isIngestPrincipal(caller.actor)) {
    return refused('not_permitted', { actor: caller.actor.identity });
  }
  const at = ports.clock.now();
  return ports.store.transaction(async (tx) => {
    const harness = await tx.harnesses.read.byId(input.harnessId);
    if (harness === null) return refused('harness_not_found', { harnessId: input.harnessId });
    const events = await appended(tx, recordContext(ports, caller, at), input);
    const [event] = events ?? [];
    if (event === undefined) return refused('item_not_found', { itemId: input.itemId });
    return accepted({ eventId: event.eventId });
  });
}
