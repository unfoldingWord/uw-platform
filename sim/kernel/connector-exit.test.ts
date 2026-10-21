import type { GateDecision, Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import {
  createKernel,
  notWiredCall,
  software,
  type Connectors,
  type GitHubFacts,
  type Kernel,
  type KernelOutcome,
  type PullRequestRef,
} from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller, simPerson, simSeenHead } from '../fixtures.ts';
import { readWorldLog } from '../runner/log.ts';
import {
  approvedBy,
  greenFacts,
  itemLog,
  namesSince,
  simParkedAtShip,
  simSha,
  standardChange,
} from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly itemId: string;
  readonly ian: Principal;
  readonly max: Principal;
};

const ianSubmitsAnotherHead = simSha('fff999');
const head = standardChange.head;

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
    const reviews = [approvedBy('uw-reviewer[bot]', 'anthropic', head, 9100000101)];
    world.adapters.githubFacts.given(greenFacts(world, { itemId: parked.itemId, head, reviews }));
    await work({ world, harnessId: harness.id, itemId: parked.itemId, ian: admin, max });
    expect((await readWorldLog(world.adapters.store)).drift).toEqual([]);
  } finally {
    await world.close();
  }
}

function sceneIt(title: string, work: (scene: Scene) => Promise<void>): void {
  it(title, () => inScene(work));
}

async function approve(scene: Scene, kernel: Kernel = scene.world.kernel) {
  return kernel.gates.decide(simCaller(scene.world, scene.ian), {
    itemId: scene.itemId,
    decision: 'approve',
    reason: null,
    findings: [],
    seenHead: await simSeenHead(scene.world, scene.itemId),
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
  expect(namesSince(before, after)).toEqual(['risk_derived', 'gate_approved', 'connector_refused']);
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
      connectors: {
        run: () => notWiredCall('connectors', 'run'),
        outcomeOf: () => notWiredCall('connectors', 'outcomeOf'),
        review: () => notWiredCall('connectors', 'review'),
      },
    });
    await expectParkedAfterRefusal(scene, kernel, 'not_wired');
  });

  sceneIt('records the error name when the connector throws', async (scene) => {
    const run = () => Promise.reject(new TypeError('socket closed'));
    await expectParkedAfterRefusal(
      scene,
      kernelWith(scene, {
        connectors: {
          run,
          outcomeOf: async () => null,
          review: () => notWiredCall('connectors', 'review'),
        },
      }),
      'connector_error: TypeError',
    );
  });
});

describe('KN-13 approve at Ship reads the GitHub facts before its transaction', () => {
  sceneIt('refuses as not_wired and writes nothing when the facts are not wired', async (scene) => {
    const githubFacts: GitHubFacts = {
      pullRequest: () => notWiredCall('githubFacts', 'pullRequest'),
      refresh: () => notWiredCall('githubFacts', 'refresh'),
      diff: () => notWiredCall('githubFacts', 'diff'),
      epic: async () => null,
      authors: async () => [],
    };
    const before = await itemLog(scene.world, scene.harnessId, scene.itemId);
    const outcome = await approve(scene, kernelWith(scene, { githubFacts }));
    expect(outcome).toMatchObject({ status: 'error', reason: 'not_wired' });
    expect(await itemLog(scene.world, scene.harnessId, scene.itemId)).toEqual(before);
    expect(scene.world.adapters.connectors.calls()).toEqual([]);
  });

  sceneIt(
    'refuses head_mismatch when the item moved to another head after the read, even with green facts on the new head',
    async (scene) => {
      const moved = async () => {
        await resubmitAnotherHead(scene);
        const onNew = ianSubmitsAnotherHead;
        const reviews = [approvedBy('uw-reviewer[bot]', 'anthropic', onNew, 9100000102)];
        return greenFacts(scene.world, { itemId: scene.itemId, head: onNew, reviews });
      };
      const githubFacts: GitHubFacts = {
        pullRequest: moved,
        refresh: moved,
        diff: () => notWiredCall('githubFacts', 'diff'),
        epic: async () => null,
        authors: async () => [],
      };
      const before = await itemLog(scene.world, scene.harnessId, scene.itemId);
      const outcome = await approve(scene, kernelWith(scene, { githubFacts }));
      expect(outcome).toEqual({
        status: 'error',
        reason: 'head_mismatch',
        detail: { why: 'not_the_head_you_saw', expectedHead: ianSubmitsAnotherHead },
      });
      const after = await itemLog(scene.world, scene.harnessId, scene.itemId);
      expect(namesSince(before, after)).not.toContain('ship_refused');
      expect(namesSince(before, after)).not.toContain('gate_approved');
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
  expect(submitted.item).toMatchObject({
    gateStatus: 'parked',
    expectedHead: ianSubmitsAnotherHead,
  });
}

type Gate = {
  readonly running: Promise<void>;
  readonly release: () => void;
  readonly connectors: Connectors;
};

function gatedConnectors(scene: Scene): Gate {
  let started: () => void = () => undefined;
  let release: () => void = () => undefined;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  const connectors: Connectors = {
    run: async (request) => {
      started();
      await opened;
      return scene.world.adapters.connectors.run(request);
    },
    outcomeOf: (request) => scene.world.adapters.connectors.outcomeOf(request),
    review: () => notWiredCall('connectors', 'review'),
  };
  return { running, release, connectors };
}

describe('KN-13 an approval whose connector has not reported refuses a second one', () => {
  sceneIt('runs the connector once when a second approve overlaps the first', async (scene) => {
    const gate = gatedConnectors(scene);
    const kernel = kernelWith(scene, { connectors: gate.connectors });
    const first = approve(scene, kernel);
    await gate.running;
    const before = await itemLog(scene.world, scene.harnessId, scene.itemId);
    const second = await approve(scene, kernel);
    expect(second).toMatchObject({ status: 'error', reason: 'decision_in_flight' });
    expect(await itemLog(scene.world, scene.harnessId, scene.itemId)).toEqual(before);
    gate.release();
    expect(value(await first)).toMatchObject({ advanced: true, item: { stageKey: 'validate' } });
    expect(scene.world.adapters.connectors.calls()).toHaveLength(1);
    expect((await itemLog(scene.world, scene.harnessId, scene.itemId)).decisions).toEqual([
      'approve',
    ]);
  });
});

async function decideWith(scene: Scene, decision: GateDecision) {
  return scene.world.kernel.gates.decide(simCaller(scene.world, scene.ian), {
    itemId: scene.itemId,
    decision,
    reason: null,
    findings: decision === 'reject' ? ['not yet'] : [],
    seenHead: await simSeenHead(scene.world, scene.itemId),
  });
}

async function holderCannotRepark(scene: Scene): Promise<void> {
  const max = simCaller(scene.world, scene.max);
  const { items } = scene.world.kernel;
  const claimed = await items.claim(max, { itemId: scene.itemId, delegationId: null });
  expect(claimed.status).toBe('error');
  const submitted = await items.submit(max, {
    itemId: scene.itemId,
    to: null,
    evidence: {},
    change: { ...standardChange, head: ianSubmitsAnotherHead },
  });
  expect(submitted.status).toBe('error');
}

describe('KN-13 no gate decision is taken while an approval awaits its connector', () => {
  sceneIt('refuses take over and reject mid-flight, then accepts them after', async (scene) => {
    const gate = gatedConnectors(scene);
    const first = approve(scene, kernelWith(scene, { connectors: gate.connectors }));
    await gate.running;
    const before = await itemLog(scene.world, scene.harnessId, scene.itemId);
    for (const decision of ['take_over', 'reject'] as const) {
      expect(await decideWith(scene, decision)).toMatchObject({
        status: 'error',
        reason: 'decision_in_flight',
      });
    }
    await holderCannotRepark(scene);
    expect(await itemLog(scene.world, scene.harnessId, scene.itemId)).toEqual(before);
    scene.world.adapters.connectors.refuseNext('merge', 'merge conflict');
    gate.release();
    expect(value(await first)).toMatchObject({ advanced: false, item: { gateStatus: 'parked' } });
    expect(value(await decideWith(scene, 'reject')).item.gateStatus).toBe('working');
    const { decisions } = await itemLog(scene.world, scene.harnessId, scene.itemId);
    expect(decisions).toEqual(['approve', 'reject']);
  });
});

describe('KN-13 the stage exit advances the parking that was approved', () => {
  sceneIt('refuses a take over tried while the merge runs, then advances', async (scene) => {
    let midFlight: KernelOutcome<unknown> | null = null;
    const connectors: Connectors = {
      run: async () => {
        midFlight = await decideWith(scene, 'take_over');
        return { outcome: 'succeeded', detail: {} };
      },
      outcomeOf: async () => null,
      review: () => notWiredCall('connectors', 'review'),
    };
    const before = await itemLog(scene.world, scene.harnessId, scene.itemId);
    const decided = value(await approve(scene, kernelWith(scene, { connectors })));
    expect(midFlight).toMatchObject({ status: 'error', reason: 'decision_in_flight' });
    expect(decided).toMatchObject({ advanced: true, item: { stageKey: 'validate' } });
    const after = await itemLog(scene.world, scene.harnessId, scene.itemId);
    expect(namesSince(before, after)).toEqual([
      'risk_derived',
      'gate_approved',
      'connector_succeeded',
      'stage_advanced',
    ]);
  });
});

describe('KN-13 approve at Ship reads GitHub only for an admin and never throws on a failed read', () => {
  sceneIt('refuses an area editor before any GitHub read', async (scene) => {
    let reads = 0;
    const counted = async (ref: PullRequestRef) => {
      reads += 1;
      return scene.world.adapters.githubFacts.pullRequest(ref);
    };
    const githubFacts: GitHubFacts = {
      pullRequest: counted,
      refresh: counted,
      diff: () => notWiredCall('githubFacts', 'diff'),
      epic: async () => null,
      authors: async () => [],
    };
    const kernel = kernelWith(scene, { githubFacts });
    const outcome = await kernel.gates.decide(simCaller(scene.world, scene.max), {
      itemId: scene.itemId,
      decision: 'approve',
      reason: null,
      findings: [],
      seenHead: await simSeenHead(scene.world, scene.itemId),
    });
    expect(outcome).toMatchObject({ status: 'error', reason: 'not_permitted' });
    expect(reads).toBe(0);
  });

  sceneIt('refuses internal_error and writes nothing when the read fails', async (scene) => {
    const limited = () => Promise.reject(new RangeError('rate limited'));
    const githubFacts: GitHubFacts = {
      pullRequest: limited,
      refresh: limited,
      diff: () => notWiredCall('githubFacts', 'diff'),
      epic: async () => null,
      authors: async () => [],
    };
    const before = await itemLog(scene.world, scene.harnessId, scene.itemId);
    const outcome = await approve(scene, kernelWith(scene, { githubFacts }));
    expect(outcome).toMatchObject({ status: 'error', reason: 'internal_error' });
    expect(await itemLog(scene.world, scene.harnessId, scene.itemId)).toEqual(before);
  });
});
