import { harnessSchema, itemStateSchema, stageSchema, type ItemState } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import type { StoreTransaction } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createItem,
  draft,
  recordContext,
  recordHarnessEvents,
  recordItemEvents,
  type RecordContext,
} from '../../packages/harness/items/record.ts';
import { simCaller, simIan } from '../fixtures.ts';
import type { Scenario } from '../scenario.ts';
import { createWorld, type World } from '../world.ts';
import { runScenario, type LoadedScenario } from './run.ts';

afterAll(closeEmbeddedTemplate);

const worldTimeout = 60_000;
const harnessId = '00000000-0000-4000-8000-0000000000a1';
const stageId = '00000000-0000-4000-8000-0000000000c1';
const itemId = '00000000-0000-4000-8000-0000000000b1';

const harness = harnessSchema.parse({
  id: harnessId,
  key: 'software',
  template: 'software',
  jdArea: '80-89',
  hostedBuilderEnabled: false,
  paused: false,
});
const stage = stageSchema.parse({
  id: stageId,
  harnessId,
  key: 'build',
  title: 'Build',
  position: 10,
  bracket: 'build_package',
  agentPickup: 'allowed',
  exitGate: 'checks',
  connector: 'none',
  wipLimit: 3,
  instructionsPageId: null,
  validators: [],
  feeds: [],
  paused: false,
});

async function contextOf(world: World): Promise<RecordContext> {
  const caller = simCaller(world, await simIan(world));
  return recordContext(world.adapters, caller, world.adapters.clock.now());
}

async function seeded(context: RecordContext, tx: StoreTransaction): Promise<void> {
  await tx.harnesses.write.insert(harness, context.at);
  await tx.harnessStages.write.insert(stage);
}

async function withTwoItemEvents(context: RecordContext, tx: StoreTransaction): Promise<ItemState> {
  await seeded(context, tx);
  await createItem(tx, context, {
    itemId,
    harnessId,
    stageKey: 'build',
    title: 'Item',
    pageId: null,
    priority: 0,
    due: null,
  });
  const recorded = await recordItemEvents(tx, context, itemId, [
    draft('item_claimed', {
      holder: context.actor,
      claimantKind: 'person',
      delegationId: null,
      leaseExpiresAt: null,
    }),
  ]);
  return recorded.item;
}

function scenarioOf(id: string, run: Scenario['run']): LoadedScenario {
  return { name: id, scenario: { id, title: `the ${id} fixture`, run } };
}

const consistent = scenarioOf('ZZ-10.consistent', async (world) => {
  const context = await contextOf(world);
  await world.adapters.store.transaction((tx) => withTwoItemEvents(context, tx));
  return { state: {} };
});

const drifting = scenarioOf('ZZ-10.drifting', async (world) => {
  const context = await contextOf(world);
  await world.adapters.store.transaction(async (tx) => {
    const item = await withTwoItemEvents(context, tx);
    await tx.harnessItems.write.project(itemStateSchema.parse({ ...item, title: 'drifted' }));
  });
  return { state: {} };
});

const topical = scenarioOf('ZZ-10.topical', async (world) => {
  const context = await contextOf(world);
  await world.adapters.store.transaction(async (tx) => {
    const item = await withTwoItemEvents(context, tx);
    await tx.harnessItems.write.project(itemStateSchema.parse({ ...item, zulipTopic: 'a topic' }));
  });
  return { state: {} };
});

const long = scenarioOf('ZZ-10.long', async (world) => {
  const context = await contextOf(world);
  await world.adapters.store.transaction(async (tx) => {
    await seeded(context, tx);
    const drafts = Array.from({ length: 230 }, () =>
      draft('delegation_required', { stage: 'build' }),
    );
    await recordHarnessEvents(tx, context, harnessId, drafts);
  });
  return { state: {} };
});

describe('KN-4 DX-4 the runner reads the log and fails a scenario whose projection drifts', () => {
  it(
    'passes a consistent scenario and reports the log events in position order',
    async () => {
      const result = await runScenario(consistent, () => createWorld());
      expect(result.failure).toBeNull();
      const events = result.report?.events ?? [];
      expect(events.map((event) => [event.position, event.name])).toEqual([
        [1, 'item_created'],
        [2, 'item_claimed'],
      ]);
      expect(result.report?.state).toEqual({});
    },
    worldTimeout,
  );

  it(
    'does not call a topic the log cannot rebuild drift',
    async () => {
      const result = await runScenario(topical, () => createWorld());
      expect(result.failure).toBeNull();
    },
    worldTimeout,
  );

  it(
    'fails a scenario whose projection differs from the replay, naming the field',
    async () => {
      const result = await runScenario(drifting, () => createWorld());
      expect(result.report).toBeNull();
      expect(result.failure).toContain('projection drift');
      expect(result.failure).toContain('title');
      expect(result.failure).not.toContain('stage');
    },
    worldTimeout,
  );

  it(
    'reads a harness with 230 events whole',
    async () => {
      const result = await runScenario(long, () => createWorld());
      expect(result.failure).toBeNull();
      const positions = (result.report?.events ?? []).map((event) => event.position);
      expect(positions).toEqual(Array.from({ length: 230 }, (_, index) => index + 1));
    },
    worldTimeout,
  );
});
