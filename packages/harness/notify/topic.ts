import { zulipTopicSchema, type ItemState } from '@uw/contracts';

export function itemRefOf(item: Pick<ItemState, 'itemId' | 'issue'>): string {
  if (item.issue === null) return `item-${item.itemId.slice(0, 8)}`;
  const name = item.issue.repo.slice(item.issue.repo.indexOf('/') + 1);
  return `${name}#${item.issue.number}`;
}

export function topicFor(harnessKey: string, itemRef: string | null): string {
  const whole = itemRef === null ? harnessKey : `${harnessKey}/${itemRef}`;
  return zulipTopicSchema.parse(whole.slice(0, 60).trimEnd());
}
