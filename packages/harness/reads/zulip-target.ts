import type { JdArea } from '@uw/contracts';
import { isIngestPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { sameTopic } from '../notify/topic.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { StoreTransaction } from '../ports.ts';

export type ZulipTarget = {
  readonly harnessId: string;
  readonly jdArea: JdArea;
  readonly itemId: string | null;
};

export async function zulipTarget(
  tx: StoreTransaction,
  caller: Caller,
  topic: string,
): Promise<KernelOutcome<ZulipTarget>> {
  if (!isIngestPrincipal(caller.actor)) return refused('not_permitted', { topic });
  const slash = topic.indexOf('/');
  const key = slash < 0 ? topic : topic.slice(0, slash);
  const harness = await tx.harnesses.read.byKey(key.toLowerCase());
  if (harness === null) return refused('harness_not_found', { topic });
  const found = { harnessId: harness.id, jdArea: harness.jdArea };
  if (slash < 0) return accepted({ ...found, itemId: null });
  const items = (await tx.harnessItems.read.forHarness(harness.id)).filter((item) =>
    sameTopic(item.zulipTopic, topic),
  );
  const [item, ...others] = items;
  if (item === undefined) return refused('item_not_found', { topic });
  if (others.length > 0) return refused('item_not_found', { topic, why: 'ambiguous_topic' });
  return accepted({ ...found, itemId: item.itemId });
}
