import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  eventEvidenceSchemas,
  identitySchema,
  type NewHarnessEvent,
} from '../../packages/contracts/index.ts';
import { closeEmbeddedTemplate } from '../../packages/db/embedded.ts';
import { readAllEvents, replay, software, type Caller } from '../../packages/harness/index.ts';
import {
  createItem,
  recordContext,
  recordItemEvents,
  type EventDraft,
} from '../../packages/harness/items/record.ts';
import { createSimHarness, simCaller } from '../../sim/fixtures.ts';
import { createWorld, type World } from '../../sim/world.ts';
import { itemEventSequence } from './item-events.ts';

type Setup = { readonly world: World; readonly harnessId: string; readonly caller: Caller };

const agent = 'agent:builder';

let setup: Setup | null = null;

beforeAll(async () => {
  const world = await createWorld();
  const { harness, admin } = await createSimHarness(world, software);
  setup = { world, harnessId: harness.id, caller: simCaller(world, admin) };
});

afterAll(async () => {
  await setup?.world.close();
  await closeEmbeddedTemplate();
});

function required(): Setup {
  if (setup === null) throw new Error('the world was not created');
  return setup;
}

function asDraft(event: NewHarnessEvent): EventDraft {
  return { name: event.name, evidence: event.evidence };
}

async function recordSequence(
  ready: Setup,
  events: readonly NewHarnessEvent[],
  batch: number,
): Promise<string> {
  const { world } = ready;
  const { store, ids, clock } = world.adapters;
  const itemId = ids.next();
  const context = recordContext(world.adapters, ready.caller, clock.now());
  const [first, ...rest] = events;
  if (first === undefined) throw new Error('a sequence starts with item_created');
  const created = eventEvidenceSchemas.item_created.parse(first.evidence);
  await store.transaction((tx) =>
    createItem(tx, context, {
      itemId,
      harnessId: ready.harnessId,
      stageKey: created.stage,
      title: created.title,
      pageId: created.pageId,
      priority: created.priority,
      due: created.due,
    }),
  );
  for (let index = 0; index < rest.length; index += batch) {
    const drafts = rest.slice(index, index + batch).map(asDraft);
    const varied = {
      ...context,
      at: new Date(context.at.getTime() + (index + 1) * 60_000),
      actor: index % 2 === 0 ? context.actor : identitySchema.parse(agent),
    };
    await store.transaction(async (tx) => {
      await tx.harnessItems.read.lock(itemId);
      return recordItemEvents(tx, varied, itemId, drafts);
    });
  }
  return itemId;
}

async function projectionAndReplay(ready: Setup, itemId: string) {
  return ready.world.adapters.store.transaction(async (tx) => ({
    row: await tx.harnessItems.read.byId(itemId),
    replayed: replay(await readAllEvents(tx, ready.harnessId, itemId)),
  }));
}

describe('KN-4 the projection equals the replay over random valid sequences recorded through the store', () => {
  it('holds for 40 random sequences recorded in random batches', async () => {
    const ready = required();
    const property = fc.asyncProperty(
      itemEventSequence(),
      fc.integer({ min: 1, max: 5 }),
      async ({ events }, batch) => {
        const { row, replayed } = await projectionAndReplay(
          ready,
          await recordSequence(ready, events, batch),
        );
        expect(row).toEqual(replayed);
      },
    );
    await fc.assert(property, { numRuns: 40 });
  }, 120_000);
});
