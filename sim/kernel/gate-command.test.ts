import {
  identitySchema,
  type GateDecision,
  type HarnessEvent,
  type Principal,
} from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { revokeSeededGrant } from '@uw/db/test-seed';
import { readAllEvents, software, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simParkedAtCheck, simPerson } from '../fixtures.ts';
import { readWorldLog } from '../runner/log.ts';
import { simSha } from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly itemId: string;
  readonly ian: Principal;
  readonly kim: Principal;
  readonly max: Principal;
};

type Decide = {
  readonly decision: GateDecision;
  readonly reason?: string | null;
  readonly findings?: readonly string[];
  readonly itemId?: string;
};

function value<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

function reasonOf(outcome: KernelOutcome<unknown>): string | null {
  return outcome.status === 'error' ? outcome.reason : null;
}

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    const kim = await simPerson(world, 4, [{ role: 'admin', ...area }]);
    const max = await simPerson(world, 5, [{ role: 'editor', ...area }]);
    const parked = await simParkedAtCheck(world, { harnessId: harness.id, admin, title: 'Gate' });
    await work({ world, harnessId: harness.id, itemId: parked.itemId, ian: admin, kim, max });
    expect((await readWorldLog(world.adapters.store)).drift).toEqual([]);
  } finally {
    await world.close();
  }
}

function sceneIt(title: string, work: (scene: Scene) => Promise<void>): void {
  it(title, () => inScene(work));
}

function decideAs(scene: Scene, actor: Principal, input: Decide) {
  return scene.world.kernel.gates.decide(simCaller(scene.world, actor), {
    itemId: input.itemId ?? scene.itemId,
    decision: input.decision,
    reason: input.reason ?? null,
    findings: input.findings ?? [],
  });
}

type Written = {
  readonly events: readonly HarnessEvent[];
  readonly decisions: readonly GateDecision[];
};

function written(scene: Scene): Promise<Written> {
  return scene.world.adapters.store.transaction(async (tx) => ({
    events: await readAllEvents(tx, scene.harnessId, scene.itemId),
    decisions: (await tx.gateDecisions.read.forItem(scene.itemId)).map((row) => row.decision),
  }));
}

function namesAfter(before: Written, after: Written): string[] {
  return after.events.slice(before.events.length).map((event) => event.name);
}

async function withAclRisk(scene: Scene): Promise<void> {
  const ian = simCaller(scene.world, scene.ian);
  value(await decideAs(scene, scene.ian, { decision: 'take_over' }));
  const submitted = await scene.world.kernel.items.submit(ian, {
    itemId: scene.itemId,
    to: null,
    evidence: {},
    change: {
      pullRequest: { repo: 'unfoldingWord/uw-platform', number: 7 },
      head: simSha('abc123'),
      paths: ['packages/core/acl.ts'],
      declaration: null,
    },
  });
  expect(value(submitted).item).toMatchObject({ gateStatus: 'parked', riskDomains: ['acl'] });
}

describe('KN-13 the gate decision command decides only an item parked at a gate', () => {
  sceneIt('refuses a decision on a working item with item_not_at_gate', async (scene) => {
    value(await decideAs(scene, scene.ian, { decision: 'reject' }));
    const before = await written(scene);
    const outcome = await decideAs(scene, scene.ian, { decision: 'approve' });
    expect(reasonOf(outcome)).toBe('item_not_at_gate');
    expect(await written(scene)).toEqual(before);
  });
});

describe('KN-13 override requires a non-empty reason', () => {
  sceneIt('refuses an override with a blank reason and writes nothing', async (scene) => {
    const before = await written(scene);
    const outcome = await decideAs(scene, scene.ian, { decision: 'override', reason: '  ' });
    expect(reasonOf(outcome)).toBe('reason_required');
    expect(await written(scene)).toEqual(before);
  });
});

describe('KN-13 the approver grants are re-read under lock and must still cover every grant', () => {
  sceneIt('refuses a stale principal whose admin grant was revoked', async (scene) => {
    const [grant] = scene.kim.grants;
    if (grant === undefined) throw new Error('Kim holds no grant');
    await revokeSeededGrant(
      scene.world.database.db,
      grant.grantId,
      scene.world.adapters.clock.now(),
    );
    const before = await written(scene);
    const outcome = await decideAs(scene, scene.kim, { decision: 'approve' });
    expect(reasonOf(outcome)).toBe('approver_lacks_domain_grant');
    const after = await written(scene);
    expect(namesAfter(before, after)).toEqual(['ship_refused']);
    expect(after.events.at(-1)?.evidence).toEqual({
      stage: 'check',
      reasons: ['approver_lacks_domain_grant'],
    });
    expect(after.decisions).toEqual([]);
  });

  sceneIt('refuses an area admin on an item whose risk domain needs org admin', async (scene) => {
    await withAclRisk(scene);
    const before = await written(scene);
    const outcome = await decideAs(scene, scene.kim, { decision: 'approve' });
    expect(reasonOf(outcome)).toBe('approver_lacks_domain_grant');
    expect(namesAfter(before, await written(scene))).toEqual(['ship_refused']);
    const approved = value(await decideAs(scene, scene.ian, { decision: 'approve' }));
    expect(approved).toMatchObject({ advanced: true, item: { stageKey: 'ship' } });
    expect((await written(scene)).decisions).toEqual(['take_over', 'approve']);
  });

  sceneIt('refuses a reject from an admin whose grant was revoked', async (scene) => {
    const [grant] = scene.kim.grants;
    if (grant === undefined) throw new Error('Kim holds no grant');
    await revokeSeededGrant(
      scene.world.database.db,
      grant.grantId,
      scene.world.adapters.clock.now(),
    );
    const before = await written(scene);
    const outcome = await decideAs(scene, scene.kim, { decision: 'reject' });
    expect(reasonOf(outcome)).toBe('not_permitted');
    expect(await written(scene)).toEqual(before);
  });
});

describe('KN-13 the gate decision command requires admin on the harness area', () => {
  sceneIt('refuses every decision by an area editor and writes nothing', async (scene) => {
    const before = await written(scene);
    for (const decision of ['approve', 'reject', 'take_over'] as const) {
      expect(reasonOf(await decideAs(scene, scene.max, { decision }))).toBe('not_permitted');
    }
    expect(await written(scene)).toEqual(before);
  });

  sceneIt('lets an area admin reject with findings', async (scene) => {
    const rejected = value(
      await decideAs(scene, scene.kim, { decision: 'reject', findings: ['no down path'] }),
    );
    expect(rejected).toMatchObject({ advanced: false, item: { gateStatus: 'working' } });
    expect((await written(scene)).decisions).toEqual(['reject']);
  });
});

describe('KN-13 an agent principal can write no gate decision', () => {
  sceneIt('refuses every decision by an agent holding org admin', async (scene) => {
    const agent = simAgent(scene.ian, 'reviewer', { interactive: true });
    const before = await written(scene);
    for (const decision of ['approve', 'reject', 'take_over', 'override'] as const) {
      const outcome = await decideAs(scene, agent, { decision, reason: 'because' });
      expect(reasonOf(outcome)).toBe('gate_refused_to_agent');
    }
    const after = await written(scene);
    expect(namesAfter(before, after)).toEqual(Array(4).fill('gate_refused_to_agent'));
    expect(after.events.slice(-4).map((event) => event.evidence['decision'])).toEqual([
      'approve',
      'reject',
      'take_over',
      'override',
    ]);
    expect(after.decisions).toEqual([]);
  });
});

const withoutPullRequest = ['pr_not_open', 'head_mismatch', 'checks_not_green'] as const;

describe('KN-13 approve or override at Ship evaluates the ship rule', () => {
  sceneIt('refuses an item with no pull request with every reason in order', async (scene) => {
    value(await decideAs(scene, scene.ian, { decision: 'approve' }));
    const ian = simCaller(scene.world, scene.ian);
    value(await scene.world.kernel.items.claim(ian, { itemId: scene.itemId, delegationId: null }));
    const parked = value(
      await scene.world.kernel.items.submit(ian, {
        itemId: scene.itemId,
        to: null,
        evidence: {},
        change: null,
      }),
    );
    expect(parked.item).toMatchObject({ stageKey: 'ship', gateStatus: 'parked' });
    const before = await written(scene);
    const approved = await decideAs(scene, scene.ian, { decision: 'approve' });
    const overridden = await decideAs(scene, scene.ian, { decision: 'override', reason: 'go' });
    const after = await written(scene);
    expect(namesAfter(before, after)).toEqual(['ship_refused', 'ship_refused']);
    expect(after.events.slice(-2).map((event) => event.evidence['reasons'])).toEqual([
      [...withoutPullRequest, 'no_reviewer_approval', 'risk_tier_undeclared'],
      [...withoutPullRequest, 'risk_tier_undeclared'],
    ]);
    expect([reasonOf(approved), reasonOf(overridden)]).toEqual(['pr_not_open', 'pr_not_open']);
    expect(after.decisions).toEqual(before.decisions);
    expect(scene.world.adapters.connectors.calls()).toEqual([]);
  });
});

describe('the gate decision command on an item that does not exist', () => {
  sceneIt('refuses a decision on an item that does not exist', async (scene) => {
    const itemId = '00000000-0000-4000-8000-00000000dead';
    const agent = simAgent(scene.ian, 'reviewer', { interactive: true });
    expect(reasonOf(await decideAs(scene, scene.ian, { decision: 'approve', itemId }))).toBe(
      'item_not_found',
    );
    expect(reasonOf(await decideAs(scene, agent, { decision: 'approve', itemId }))).toBe(
      'item_not_found',
    );
  });
});

async function setStage(scene: Scene, stageKey: string, change: Record<string, unknown>) {
  value(
    await scene.world.kernel.stages.updateStage(simCaller(scene.world, scene.ian), {
      harnessId: scene.harnessId,
      stageKey,
      change,
    }),
  );
}

async function submitAsIan(scene: Scene, to: string | null) {
  const ian = simCaller(scene.world, scene.ian);
  return value(
    await scene.world.kernel.items.submit(ian, {
      itemId: scene.itemId,
      to,
      evidence: {},
      change: null,
    }),
  );
}

describe('KN-13 override advances with its reason recorded', () => {
  sceneIt('overrides at Check with a trimmed reason and advances to Ship', async (scene) => {
    const before = await written(scene);
    const overridden = value(
      await decideAs(scene, scene.ian, { decision: 'override', reason: '  known risk  ' }),
    );
    expect(overridden).toMatchObject({ advanced: true, item: { stageKey: 'ship' } });
    const rows = await scene.world.adapters.store.transaction((tx) =>
      tx.gateDecisions.read.forItem(scene.itemId),
    );
    expect(rows.map((row) => [row.decision, row.reason])).toEqual([['override', 'known risk']]);
    const after = await written(scene);
    expect(namesAfter(before, after)).toEqual(['gate_overridden', 'stage_advanced']);
    expect(after.events.at(-2)?.evidence).toEqual({
      decisionId: overridden.decisionId,
      stage: 'check',
      reason: 'known risk',
    });
  });
});

describe('KN-13 take over reassigns the item to a person within the stage WIP limit', () => {
  sceneIt('refuses a take over at a WIP-full stage and writes nothing', async (scene) => {
    const other = await simParkedAtCheck(scene.world, {
      harnessId: scene.harnessId,
      admin: scene.ian,
      title: 'Other',
    });
    await setStage(scene, 'check', { wipLimit: 1 });
    value(await decideAs(scene, scene.ian, { decision: 'take_over', itemId: other.itemId }));
    const before = await written(scene);
    const outcome = await decideAs(scene, scene.ian, { decision: 'take_over' });
    expect(reasonOf(outcome)).toBe('wip_limit_reached');
    expect(await written(scene)).toEqual(before);
  });
});

function crafted(kind: Principal['kind'], identity: string, owner: Principal): Principal {
  return { ...owner, kind, identity: identitySchema.parse(identity) };
}

describe('KN-13 only a human principal may decide, whatever its kind field says', () => {
  sceneIt(
    'refuses an agent kind with a human identity and a person kind with an agent identity',
    async (scene) => {
      const before = await written(scene);
      for (const principal of [
        crafted('agent', scene.ian.identity, scene.ian),
        crafted('person', 'agent:reviewer', scene.ian),
      ]) {
        const outcome = await decideAs(scene, principal, { decision: 'approve' });
        expect(reasonOf(outcome)).toBe('gate_refused_to_agent');
      }
      const after = await written(scene);
      expect(namesAfter(before, after)).toEqual(Array(2).fill('gate_refused_to_agent'));
      expect(after.decisions).toEqual([]);
    },
  );
});

describe('KN-13 approve without a connector takes the exit the item is parked for', () => {
  sceneIt('takes the loop edge for a tweak parked at a human approval stage', async (scene) => {
    value(await decideAs(scene, scene.ian, { decision: 'take_over' }));
    await setStage(scene, 'check', { feeds: ['scope'] });
    expect((await submitAsIan(scene, 'scope')).item).toMatchObject({
      gateStatus: 'parked',
      gateTarget: 'scope',
    });
    const before = await written(scene);
    const approved = value(await decideAs(scene, scene.ian, { decision: 'approve' }));
    expect(approved.item).toMatchObject({ stageKey: 'scope', gateStatus: 'working' });
    const after = await written(scene);
    expect(namesAfter(before, after)).toEqual(['gate_approved', 'loop_edge_taken']);
    expect(after.events.at(-1)?.evidence).toEqual({ from: 'check', to: 'scope' });
  });

  sceneIt(
    'finishes the item when the last stage is a human approval without a connector',
    async (scene) => {
      await setStage(scene, 'check', { position: 90 });
      const before = await written(scene);
      const approved = value(await decideAs(scene, scene.ian, { decision: 'approve' }));
      expect(approved).toMatchObject({ advanced: true, item: { gateStatus: 'done' } });
      const after = await written(scene);
      expect(namesAfter(before, after)).toEqual(['gate_approved', 'stage_advanced']);
      expect(after.events.at(-1)?.evidence).toEqual({ from: 'check', to: null });
    },
  );
});
