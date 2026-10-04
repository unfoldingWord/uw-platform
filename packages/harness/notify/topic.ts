import { identitySchema, zulipTopicSchema, type ItemState } from '@uw/contracts';
import { topicLinkIdentity } from '../access.ts';
import { draft, recordItemEvents } from '../items/record.ts';
import type { Ports, StoreTransaction } from '../ports.ts';

export function itemRefOf(item: Pick<ItemState, 'itemId' | 'issue'>): string {
  if (item.issue === null) return `item-${item.itemId.slice(0, 8)}`;
  const name = item.issue.repo.slice(item.issue.repo.indexOf('/') + 1);
  return `${name}#${item.issue.number}`;
}

export function topicFor(harnessKey: string, itemRef: string | null): string {
  const whole = itemRef === null ? harnessKey : `${harnessKey}/${itemRef}`;
  return zulipTopicSchema.parse(whole.slice(0, 60).trimEnd());
}

export function sameTopic(left: string | null, right: string): boolean {
  return left !== null && left.toLowerCase() === right.toLowerCase();
}

function longRef(itemId: string): string {
  return `item-${itemId.replaceAll('-', '').slice(0, 12)}`;
}

export async function freeTopic(
  tx: Pick<StoreTransaction, 'harnessItems'>,
  item: ItemState,
  harnessKey: string,
  wanted: string = topicFor(harnessKey, itemRefOf(item)),
): Promise<string | null> {
  const others = (await tx.harnessItems.read.forHarness(item.harnessId)).filter(
    (other) => other.itemId !== item.itemId,
  );
  const taken = (topic: string) => others.some((other) => sameTopic(other.zulipTopic, topic));
  if (!taken(wanted)) return wanted;
  const fallback = topicFor(harnessKey, longRef(item.itemId));
  return taken(fallback) ? null : fallback;
}

export type TopicLink = {
  readonly itemId: string;
  readonly topic: string;
  readonly at: Date;
  readonly traceId: string;
};

export async function linkTopic(
  ports: Pick<Ports, 'store' | 'ids'>,
  input: TopicLink,
): Promise<void> {
  await ports.store.transaction(async (tx) => {
    const item = await tx.harnessItems.read.lock(input.itemId);
    if (item === null || item.zulipTopic !== null) return;
    const harness = await tx.harnesses.read.byId(item.harnessId);
    if (harness === null) return;
    const topic = await freeTopic(tx, item, harness.key, input.topic);
    if (topic === null) return;
    const context = {
      actor: identitySchema.parse(topicLinkIdentity),
      at: input.at,
      traceId: input.traceId,
      requestId: null,
      ids: ports.ids,
    };
    await recordItemEvents(tx, context, item.itemId, [draft('zulip_topic_linked', { topic })]);
  });
}
