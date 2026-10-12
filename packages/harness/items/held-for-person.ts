import type { ItemState } from '@uw/contracts';
import { isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { refused, type Refused } from '../outcome.ts';
import type { StoreTransaction } from '../ports.ts';
import { readAllEvents } from './record.ts';

export const OVER_REVIEW_BUDGET = 'diff_exceeds_review_budget';

export async function heldForPerson(tx: StoreTransaction, item: ItemState): Promise<boolean> {
  if (item.gateStatus !== 'checks_failed') return false;
  const events = await readAllEvents(tx, item.harnessId, item.itemId);
  const failed = events.filter((event) => event.name === 'checks_failed').at(-1);
  const failures = failed?.evidence['failures'];
  return Array.isArray(failures) && failures.includes(OVER_REVIEW_BUDGET);
}

export async function personHoldRefusal(
  tx: StoreTransaction,
  caller: Caller,
  item: ItemState,
): Promise<Refused | null> {
  if (!isAgent(caller.actor) || !(await heldForPerson(tx, item))) return null;
  return refused('not_permitted', { why: 'held_for_person' });
}
