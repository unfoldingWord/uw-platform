import type { Harness, Stage } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { revokeSeededGrant } from '@uw/db/test-seed';
import { readAllEvents, software, type Caller } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function withHarness(
  work: (world: World, harness: Harness, ian: Caller) => Promise<void>,
): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    await work(world, harness, simCaller(world, admin));
  } finally {
    await world.close();
  }
}

function harnessIt(
  title: string,
  work: (world: World, harness: Harness, ian: Caller) => Promise<void>,
): void {
  it(title, () => withHarness(work));
}

function logOf(world: World, harnessId: string) {
  return world.adapters.store.transaction((tx) => readAllEvents(tx, harnessId, null));
}

function stagesOf(world: World, harnessId: string): Promise<readonly Stage[]> {
  return world.adapters.store.transaction((tx) => tx.harnessStages.read.forHarness(harnessId));
}

function newStage(overrides: Partial<Omit<Stage, 'id' | 'harnessId' | 'paused'>>) {
  return {
    key: 'extra',
    title: 'Extra',
    position: 90,
    bracket: 'iterate' as const,
    agentPickup: 'allowed' as const,
    exitGate: 'checks' as const,
    connector: 'none' as const,
    wipLimit: 3,
    instructionsPageId: null,
    validators: [],
    feeds: [],
    ...overrides,
  };
}

describe('KN-18 the stage command refuses what only a human admin may do', () => {
  harnessIt(
    'refuses an agent principal that carries org admin, on activate and on update, and writes no event',
    async (world, harness, ian) => {
      const agent = simCaller(world, simAgent(ian.actor, 'builder', { interactive: false }));
      const activate = await world.kernel.stages.activate(agent, {
        harnessId: world.adapters.ids.next(),
        harnessKey: 'other',
        jdArea: '80-89',
        template: software,
        repository: null,
      });
      const update = await world.kernel.stages.updateStage(agent, {
        harnessId: harness.id,
        stageKey: 'build',
        change: { title: 'Changed' },
      });
      expect([
        activate.status === 'error' && activate.reason,
        update.status === 'error' && update.reason,
      ]).toEqual(['not_permitted', 'not_permitted']);
      expect((await logOf(world, harness.id)).map((event) => event.name)).toEqual([
        'template_activated',
      ]);
    },
  );

  harnessIt('refuses an area editor', async (world, harness) => {
    const editor = await simPerson(world, 1, [
      { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    const outcome = await world.kernel.stages.updateStage(simCaller(world, editor), {
      harnessId: harness.id,
      stageKey: 'build',
      change: { title: 'Changed' },
    });
    expect(outcome).toMatchObject({ status: 'error', reason: 'not_permitted' });
    expect((await logOf(world, harness.id)).map((event) => event.name)).toEqual([
      'template_activated',
    ]);
  });

  harnessIt('refuses an unknown harness', async (world, _harness, ian) => {
    const outcome = await world.kernel.stages.updateStage(ian, {
      harnessId: world.adapters.ids.next(),
      stageKey: 'build',
      change: { title: 'Changed' },
    });
    expect(outcome).toMatchObject({ status: 'error', reason: 'harness_not_found' });
  });
});

describe('KN-18 the stage command refuses what the kernel can see before Postgres', () => {
  harnessIt(
    'refuses an unknown validator and records stage_edit_refused with the reason',
    async (world, harness, ian) => {
      const outcome = await world.kernel.stages.createStage(ian, {
        harnessId: harness.id,
        stage: newStage({ validators: ['nope'] }),
      });
      expect(outcome).toMatchObject({
        status: 'error',
        reason: 'unknown_validator',
        detail: { stage: 'extra', validator: 'nope' },
      });
      const last = (await logOf(world, harness.id)).at(-1);
      expect(last?.name).toBe('stage_edit_refused');
      expect(last?.evidence).toMatchObject({
        reason: 'unknown_validator',
        code: null,
        constraint: null,
      });
      expect(await stagesOf(world, harness.id)).toHaveLength(8);
    },
  );
});

describe('KN-18 a dangling feeds target is refused at write time', () => {
  harnessIt('refuses a feeds target that is not a stage', async (world, harness, ian) => {
    const outcome = await world.kernel.stages.updateStage(ian, {
      harnessId: harness.id,
      stageKey: 'close',
      change: { feeds: ['nowhere'] },
    });
    expect(outcome).toMatchObject({
      status: 'error',
      reason: 'unknown_feed_target',
      detail: { stage: 'close', target: 'nowhere' },
    });
  });
});

describe('KN-18 the stage command records what Postgres refuses', () => {
  harnessIt(
    'refuses a taken key with the constraint and records it on the harness',
    async (world, harness, ian) => {
      const outcome = await world.kernel.stages.createStage(ian, {
        harnessId: harness.id,
        stage: newStage({ key: 'scope' }),
      });
      expect(outcome).toMatchObject({
        status: 'error',
        reason: 'stage_edit_refused',
        detail: { constraint: 'harness_stages_key_per_harness' },
      });
      const last = (await logOf(world, harness.id)).at(-1);
      expect(last?.name).toBe('stage_edit_refused');
      expect(last?.evidence).toMatchObject({
        stage: 'scope',
        constraint: 'harness_stages_key_per_harness',
      });
    },
  );

  harnessIt('creates and updates a stage that Postgres accepts', async (world, harness, ian) => {
    const created = await world.kernel.stages.createStage(ian, {
      harnessId: harness.id,
      stage: newStage({}),
    });
    const updated = await world.kernel.stages.updateStage(ian, {
      harnessId: harness.id,
      stageKey: 'extra',
      change: { title: 'Renamed', wipLimit: 5 },
    });
    expect(created.status).toBe('accepted');
    expect(updated).toMatchObject({
      status: 'accepted',
      value: { title: 'Renamed', wipLimit: 5 },
    });
    expect(await stagesOf(world, harness.id)).toHaveLength(9);
  });
});

describe('KN-18 reordering stages', () => {
  const keys = software.stages.map((stage) => stage.key);

  harnessIt('repositions to 10 through 80 in the given order', async (world, harness, ian) => {
    const order = [...keys].reverse();
    const outcome = await world.kernel.stages.reorderStages(ian, {
      harnessId: harness.id,
      order,
    });
    expect(outcome.status).toBe('accepted');
    const stored = [...(await stagesOf(world, harness.id))].sort((a, b) => a.position - b.position);
    expect(stored.map((stage) => [stage.key, stage.position])).toEqual(
      order.map((key, index) => [key, (index + 1) * 10]),
    );
  });

  harnessIt(
    'refuses a missing key as malformed and an unknown key as stage_not_found',
    async (world, harness, ian) => {
      const missing = await world.kernel.stages.reorderStages(ian, {
        harnessId: harness.id,
        order: keys.slice(1),
      });
      const unknown = await world.kernel.stages.reorderStages(ian, {
        harnessId: harness.id,
        order: [...keys.slice(1), 'nowhere'],
      });
      expect(missing).toMatchObject({ status: 'error', reason: 'malformed_command' });
      expect(unknown).toMatchObject({
        status: 'error',
        reason: 'stage_not_found',
        detail: { stage: 'nowhere' },
      });
    },
  );
});

describe('KN-18 activating a second harness with a taken key', () => {
  harnessIt('is refused harness_exists', async (world, _harness, ian) => {
    const outcome = await world.kernel.stages.activate(ian, {
      harnessId: world.adapters.ids.next(),
      harnessKey: 'software',
      jdArea: '30-39',
      template: software,
      repository: null,
    });
    expect(outcome).toMatchObject({ status: 'error', reason: 'harness_exists' });
  });
});

describe('KN-18 the stage command reads the admin grant again inside its transaction', () => {
  const adminGrantId = '00000000-0000-4000-8000-000000000101';

  harnessIt(
    'refuses a stale principal whose admin grant was revoked',
    async (world, harness, ian) => {
      await revokeSeededGrant(world.database.db, adminGrantId, world.adapters.clock.now());
      world.adapters.clock.advance(1000);
      const update = await world.kernel.stages.updateStage(ian, {
        harnessId: harness.id,
        stageKey: 'build',
        change: { title: 'Changed' },
      });
      const activate = await world.kernel.stages.activate(ian, {
        harnessId: world.adapters.ids.next(),
        harnessKey: 'other',
        jdArea: '80-89',
        template: software,
        repository: null,
      });
      expect(update).toMatchObject({ status: 'error', reason: 'not_permitted' });
      expect(activate).toMatchObject({ status: 'error', reason: 'not_permitted' });
      expect(
        (await stagesOf(world, harness.id)).find((stage) => stage.key === 'build')?.title,
      ).toBe('Commits to PR');
    },
  );
});

describe('KN-18 an update cannot carry identity fields', () => {
  const foreign = '00000000-0000-4000-8000-0000000000ff';

  it.each([
    ['key', { key: 'renamed' }],
    ['id', { id: foreign }],
    ['harnessId', { harnessId: foreign }],
  ])('refuses a change carrying %s and changes nothing', async (_name, extra) => {
    await withHarness(async (world, harness, ian) => {
      const before = await stagesOf(world, harness.id);
      const outcome = await world.kernel.stages.updateStage(ian, {
        harnessId: harness.id,
        stageKey: 'build',
        change: Object.assign({ title: 'Changed' }, extra),
      });
      expect(outcome).toMatchObject({ status: 'error', reason: 'malformed_command' });
      expect(await stagesOf(world, harness.id)).toEqual(before);
    });
  });
});

describe('every stage edit keeps the gate before an effect', () => {
  harnessIt(
    'refuses an update that lowers the Ship gate and a new unguarded effect stage, and records each refusal',
    async (world, harness, ian) => {
      const before = await stagesOf(world, harness.id);
      const lowered = await world.kernel.stages.updateStage(ian, {
        harnessId: harness.id,
        stageKey: 'ship',
        change: { exitGate: 'checks' },
      });
      const unguarded = await world.kernel.stages.createStage(ian, {
        harnessId: harness.id,
        stage: newStage({ connector: 'merge' }),
      });
      for (const outcome of [lowered, unguarded]) {
        expect(outcome).toMatchObject({
          status: 'error',
          reason: 'template_bypasses_gate',
          detail: { effectStage: expect.any(String) },
        });
      }
      expect(await stagesOf(world, harness.id)).toEqual(before);
      const refusals = (await logOf(world, harness.id)).filter(
        (event) => event.name === 'stage_edit_refused',
      );
      expect(refusals.map((event) => event.evidence['reason'])).toEqual([
        'template_bypasses_gate',
        'template_bypasses_gate',
      ]);
    },
  );
});
