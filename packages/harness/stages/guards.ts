import type { Harness, ItemState, Stage } from '@uw/contracts';
import { approvalsAwaitingOutcome } from '../gates/parking.ts';
import { readAllEvents } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { refused, type Refused } from '../outcome.ts';
import type { StageCursor, StoreTransaction } from '../ports.ts';

export async function instructionsRefusal(
  tx: StoreTransaction,
  harness: Harness,
  pageId: string | null | undefined,
): Promise<Refused | null> {
  if (pageId === null || pageId === undefined) return null;
  const [page] = await tx.pages.read.facts([pageId]);
  const readable = page !== undefined && page.type !== 'issue' && page.jdArea === harness.jdArea;
  if (!readable) return refused('page_not_found', { pageId });
  return page.type === 'skill'
    ? null
    : refused('malformed_command', { why: 'instructions_not_skill' });
}

const inFlightPage = 50;

async function awaitingOutcome(
  tx: StoreTransaction,
  harness: Harness,
  items: readonly ItemState[],
): Promise<ItemState | null> {
  for (const item of items) {
    const events = await readAllEvents(tx, harness.id, item.itemId);
    if (approvalsAwaitingOutcome(events).length > 0) return item;
  }
  return null;
}

export async function connectorInFlight(
  tx: StoreTransaction,
  harness: Harness,
  stage: Stage,
): Promise<Refused | null> {
  await tx.lock(lockKeys.stageClaims(stage.id));
  for (let after: StageCursor | null = null; ;) {
    const page = await tx.harnessItems.read.openInStage(harness.id, stage.key, {
      after,
      limit: inFlightPage,
    });
    const waiting = await awaitingOutcome(tx, harness, page);
    if (waiting !== null) {
      return refused('decision_in_flight', { stage: stage.key, itemId: waiting.itemId });
    }
    const last = page.at(-1);
    if (page.length < inFlightPage || last === undefined) return null;
    after = { priority: last.priority, itemId: last.itemId };
  }
}

export async function removalRefusal(
  tx: StoreTransaction,
  harness: Harness,
  stage: Stage,
): Promise<Refused | null> {
  if (stage.connector !== 'none') {
    return refused('not_permitted', { stage: stage.key, why: 'effect_stage' });
  }
  const items = await tx.harnessItems.read.forHarness(harness.id);
  if (items.some((item) => item.stageKey === stage.key)) {
    return refused('stage_not_empty', { stage: stage.key });
  }
  if (await tx.gateDecisions.read.anyForStage(stage.id)) {
    return refused('stage_not_empty', { stage: stage.key, why: 'stage_has_history' });
  }
  return null;
}
