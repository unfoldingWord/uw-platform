import type { Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import {
  createKernel,
  notWiredCall,
  software,
  type Connectors,
  type GitHubFacts,
  type Kernel,
  type KernelOutcome,
} from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller, simPerson } from '../fixtures.ts';
import { readWorldLog } from '../runner/log.ts';
import {
  approvedBy,
  greenFacts,
  itemLog,
  namesSince,
  simParkedAtShip,
  standardChange,
} from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly itemId: string;
  readonly ian: Principal;
};

const ianSubmitsAnotherHead = 'fff999';

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    const max = await simPerson(world, 2, [
      { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    const parked = await simParkedAtShip(world, {
      harnessId: harness.id,
      editor: max,
      title: 'Show the board',
      change: standardChange,
    });
    world.adapters.githubFacts.given(
      greenFacts(world, 'abc123', [approvedBy('uw-reviewer', 'anthropic', 'abc123')]),
    );
    await work({ world, harnessId: harness.id, itemId: parked.itemId, ian: admin });
    expect((await readWorldLog(world.adapters.store)).drift).toEqual([]);
  } finally {
    await world.close();
  }
}

function sceneIt(title: string, work: (scene: Scene) => Promise<void>): void {
  it(title, () => inScene(work));
}

function approve(scene: Scene, kernel: Kernel = scene.world.kernel) {
  return kernel.gates.decide(simCaller(scene.world, scene.ian), {
    itemId: scene.itemId,
    decision: 'approve',
    reason: null,
    findings: [],
  });
}

function value<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

function kernelWith(scene: Scene, ports: { connectors?: Connectors; githubFacts?: GitHubFacts }) {
  return createKernel({ ...scene.world.adapters, ...ports });
}

async function expectParkedAfterRefusal(scene: Scene, kernel: Kernel, reason: string) {
  const before = await itemLog(scene.world, scene.harnessId, scene.itemId);
  const decided = value(await approve(scene, kernel));
  expect(decided.advanced).toBe(false);
  expect(decided.item).toMatchObject({ stageKey: 'ship', gateStatus: 'parked' });
  const after = await itemLog(scene.world, scene.harnessId, scene.itemId);
  expect(after.decisions).toEqual(['approve']);
  expect(namesSince(before, after)).toEqual(['gate_approved', 'connector_refused']);
  expect(after.events.at(-1)?.evidence).toEqual({ connector: 'merge', reason });
}

describe('KN-13 a connector that refuses or is not wired leaves the decision and the item parked', () => {
  sceneIt('records the merge refusal and keeps the item parked at Ship', async (scene) => {
    scene.world.adapters.connectors.refuseNext('merge', 'merge conflict');
    await expectParkedAfterRefusal(scene, scene.world.kernel, 'merge conflict');
    expect(scene.world.adapters.connectors.calls()).toHaveLength(1);
    const retried = value(await approve(scene));
    expect(retried).toMatchObject({ advanced: true, item: { stageKey: 'validate' } });
    const after = await itemLog(scene.world, scene.harnessId, scene.itemId);
    expect(after.decisions).toEqual(['approve', 'approve']);
  });

  sceneIt('records not_wired when the connectors port is not wired', async (scene) => {
    const kernel = kernelWith(scene, {
      connectors: { run: () => notWiredCall('connectors', 'run') },
    });
    await expectParkedAfterRefusal(scene, kernel, 'not_wired');
  });

  sceneIt('records the error name when the connector throws', async (scene) => {
    const run = () => Promise.reject(new TypeError('socket closed'));
    await expectParkedAfterRefusal(
      scene,
      kernelWith(scene, { connectors: { run } }),
      'connector_error: TypeError',
    );
  });

  sceneIt(
    'records a merge that succeeded after the item left the gate, without the stage exit',
    async (scene) => {
      const connectors: Connectors = {
        run: async () => {
          await takeOver(scene);
          return { outcome: 'succeeded', detail: { sha: 'merged1' } };
        },
      };
      const before = await itemLog(scene.world, scene.harnessId, scene.itemId);
      const decided = value(await approve(scene, kernelWith(scene, { connectors })));
      expect(decided).toMatchObject({ advanced: false, item: { stageKey: 'ship' } });
      expect(decided.item.gateStatus).toBe('working');
      const after = await itemLog(scene.world, scene.harnessId, scene.itemId);
      expect(namesSince(before, after)).toEqual([
        'gate_approved',
        'gate_taken_over',
        'connector_succeeded',
      ]);
      expect(after.events.at(-1)?.evidence).toEqual({
        connector: 'merge',
        detail: { sha: 'merged1' },
      });
    },
  );
});

describe('KN-13 approve at Ship reads the GitHub facts before its transaction', () => {
  sceneIt('refuses as not_wired and writes nothing when the facts are not wired', async (scene) => {
    const githubFacts = { pullRequest: () => notWiredCall('githubFacts', 'pullRequest') };
    const before = await itemLog(scene.world, scene.harnessId, scene.itemId);
    const outcome = await approve(scene, kernelWith(scene, { githubFacts }));
    expect(outcome).toMatchObject({ status: 'error', reason: 'not_wired' });
    expect(await itemLog(scene.world, scene.harnessId, scene.itemId)).toEqual(before);
    expect(scene.world.adapters.connectors.calls()).toEqual([]);
  });

  sceneIt(
    'refuses head_mismatch when the item moved to another head after the read, even with green facts on the new head',
    async (scene) => {
      const githubFacts: GitHubFacts = {
        pullRequest: async () => {
          await resubmitAnotherHead(scene);
          const reviews = [approvedBy('uw-reviewer', 'anthropic', ianSubmitsAnotherHead)];
          return greenFacts(scene.world, ianSubmitsAnotherHead, reviews);
        },
      };
      const before = await itemLog(scene.world, scene.harnessId, scene.itemId);
      const outcome = await approve(scene, kernelWith(scene, { githubFacts }));
      expect(outcome).toMatchObject({ status: 'error', reason: 'head_mismatch' });
      const after = await itemLog(scene.world, scene.harnessId, scene.itemId);
      expect(namesSince(before, after).slice(-1)).toEqual(['ship_refused']);
      expect(after.events.at(-1)?.evidence).toEqual({ stage: 'ship', reasons: ['head_mismatch'] });
      expect(after.decisions).toEqual(['take_over']);
      expect(scene.world.adapters.connectors.calls()).toEqual([]);
    },
  );
});

async function takeOver(scene: Scene): Promise<void> {
  value(
    await scene.world.kernel.gates.decide(simCaller(scene.world, scene.ian), {
      itemId: scene.itemId,
      decision: 'take_over',
      reason: null,
      findings: [],
    }),
  );
}

async function resubmitAnotherHead(scene: Scene): Promise<void> {
  const ian = simCaller(scene.world, scene.ian);
  await takeOver(scene);
  const submitted = value(
    await scene.world.kernel.items.submit(ian, {
      itemId: scene.itemId,
      to: null,
      evidence: {},
      change: { ...standardChange, head: ianSubmitsAnotherHead },
    }),
  );
  expect(submitted.item).toMatchObject({ gateStatus: 'parked', expectedHead: 'fff999' });
}
