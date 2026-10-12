import type { HarnessEvent } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, software, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller, simPerson } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;
const enqueueRequest = '00000000-0000-4000-8000-0000000000f1';
const claimRequest = '00000000-0000-4000-8000-0000000000f2';

function value<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

async function inWorld(work: (world: World, harnessId: string) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness } = await createSimHarness(world, software);
    await work(world, harness.id);
  } finally {
    await world.close();
  }
}

function eventsOf(world: World, harnessId: string, itemId: string | null) {
  return world.adapters.store.transaction((tx) => readAllEvents(tx, harnessId, itemId));
}

function requestIdOf(event: HarnessEvent): string | null {
  return event.requestId;
}

function stampsOf(events: readonly HarnessEvent[]) {
  return events.map(({ name, actor, requestId, traceId }) => ({
    name,
    actor,
    requestId,
    traceId,
  }));
}

describe("WB-1 a command's events carry its actor, requestId and trace id", () => {
  it('stamps every event an accepted enqueue and claim append', () =>
    inWorld(async (world, harnessId) => {
      const editor = await simPerson(world, 2, [{ role: 'editor', ...area }]);
      const enqueue = simCaller(world, editor, enqueueRequest);
      const item = value(
        await world.kernel.items.enqueue(enqueue, {
          harnessId,
          title: 'Wire the board',
          pageId: null,
          priority: 1,
          due: null,
          delegationId: null,
        }),
      );
      const claim = simCaller(world, editor, claimRequest);
      value(await world.kernel.items.claim(claim, { itemId: item.itemId, delegationId: null }));
      const actor = editor.identity;
      expect(stampsOf(await eventsOf(world, harnessId, item.itemId))).toEqual([
        { name: 'item_created', actor, requestId: enqueueRequest, traceId: enqueue.traceId },
        { name: 'item_claimed', actor, requestId: claimRequest, traceId: claim.traceId },
      ]);
    }));

  it('stamps a null requestId when the caller names none', () =>
    inWorld(async (world, harnessId) => {
      const events = await eventsOf(world, harnessId, null);
      expect(events.length).toBeGreaterThan(0);
      expect(new Set(events.map(requestIdOf))).toEqual(new Set([null]));
    }));
});
