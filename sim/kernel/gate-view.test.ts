import {
  gateViewSchema,
  type GateView,
  type Principal,
  type PullRequestDeclaration,
} from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { createKernel, software, type GitHubFacts, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simParkedAtCheck, simPerson } from '../fixtures.ts';
import {
  approvedBy,
  greenFacts,
  itemLog,
  shipPullRequest,
  simParkedAtShip,
  simSha,
  type ShipChange,
} from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly itemId: string;
  readonly ian: Principal;
};

const head = simSha('a11ce');

const aclChange: ShipChange = {
  pullRequest: shipPullRequest,
  head,
  paths: ['packages/core/acl.ts'],
  declaration: { riskTier: 'high', riskDomains: ['acl'] },
};

const parsedDeclaration: PullRequestDeclaration = {
  closes: ['#7'],
  risks: 'a grant could widen',
  touches: 'the access check',
  riskTier: 'high',
  riskDomains: ['acl'],
};

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
      title: 'Tighten the access check',
      change: aclChange,
    });
    const reviews = [approvedBy('uw-reviewer[bot]', 'anthropic', head, 9100000101)];
    world.adapters.githubFacts.given(
      greenFacts(world, {
        itemId: parked.itemId,
        head,
        reviews,
        paths: aclChange.paths,
        declaration: parsedDeclaration,
      }),
    );
    await work({ world, harnessId: harness.id, itemId: parked.itemId, ian: admin });
  } finally {
    await world.close();
  }
}

function sceneIt(title: string, work: (scene: Scene) => Promise<void>): void {
  it(title, () => inScene(work));
}

function viewOf(outcome: KernelOutcome<GateView>): GateView {
  if (outcome.status !== 'accepted') throw new Error(`the view was refused: ${outcome.reason}`);
  return outcome.value;
}

async function lastRiskDerived(scene: Scene): Promise<Record<string, unknown>> {
  const { events } = await itemLog(scene.world, scene.harnessId, scene.itemId);
  const found = events.findLast((event) => event.name === 'risk_derived');
  if (found === undefined) throw new Error('no risk_derived event');
  return found.evidence;
}

type ShipOutcome = NonNullable<GateView['ship']>['outcome'];

function asOutcome(decided: KernelOutcome<unknown>): ShipOutcome {
  if (decided.status === 'accepted') return { verdict: 'advance' };
  const reasons = decided.detail['reasons'];
  if (!Array.isArray(reasons)) throw new Error(`refused without ship reasons: ${decided.reason}`);
  return gateViewSchema.shape.ship.unwrap().shape.outcome.parse({ verdict: 'refuse', reasons });
}

describe('GH-5 the gate view shows the parsed declaration, the derived tier and domains and the head they were derived at', () => {
  sceneIt('answers from the read model with what an approve would evaluate', async (scene) => {
    const caller = simCaller(scene.world, scene.ian);
    const view = viewOf(await scene.world.kernel.gates.view(caller, { itemId: scene.itemId }));
    expect(gateViewSchema.parse(view)).toEqual(view);
    expect(view.facts?.declaration).toEqual(parsedDeclaration);
    const recorded = await lastRiskDerived(scene);
    expect(view.recorded).toEqual({
      riskTier: recorded['riskTier'],
      riskDomains: recorded['riskDomains'],
      floorDomains: recorded['floorDomains'],
      head: recorded['head'],
      declaration: recorded['declaration'],
      refusal: recorded['refusal'],
    });
    expect(view.recorded).toMatchObject({ head, riskTier: 'high', riskDomains: ['acl'] });
    expect(view.ship?.derived).toEqual({ riskTier: 'high', riskDomains: ['acl'], head });
    expect(view.ship?.input.expectedHead).toBe(head);
    const decided = await scene.world.kernel.gates.decide(caller, {
      itemId: scene.itemId,
      decision: 'approve',
      reason: null,
      findings: [],
      seenHead: head,
    });
    expect(view.ship?.outcome).toEqual(asOutcome(decided));
  });
});

describe('GH-5 the gate view never reads GitHub', () => {
  sceneIt('makes no refresh call', async (scene) => {
    const sim = scene.world.adapters.githubFacts;
    let refreshes = 0;
    const githubFacts: GitHubFacts = {
      pullRequest: (ref) => sim.pullRequest(ref),
      refresh: (ref) => {
        refreshes += 1;
        return sim.refresh(ref);
      },
    };
    const kernel = createKernel({ ...scene.world.adapters, githubFacts });
    const view = viewOf(
      await kernel.gates.view(simCaller(scene.world, scene.ian), { itemId: scene.itemId }),
    );
    expect(view.facts?.head).toBe(head);
    expect(refreshes).toBe(0);
  });
});

describe('GH-5 the gate view of a hidden item is item_not_found like a missing one', () => {
  sceneIt('answers a stranger as it answers an unknown item', async (scene) => {
    const stranger = await simPerson(scene.world, 3, []);
    const missingId = '00000000-0000-4000-8000-0000000000ff';
    const caller = simCaller(scene.world, stranger);
    const hidden = await scene.world.kernel.gates.view(caller, { itemId: scene.itemId });
    const missing = await scene.world.kernel.gates.view(caller, { itemId: missingId });
    expect(hidden).toEqual({
      status: 'error',
      reason: 'item_not_found',
      detail: { itemId: scene.itemId },
    });
    expect(JSON.stringify(hidden).replace(scene.itemId, missingId)).toBe(JSON.stringify(missing));
  });
});

describe('GH-5 the gate view of an item not at a connector stage has ship null', () => {
  it('shows a parked item at Check without a ship preview', async () => {
    const world = await createWorld();
    try {
      const { harness, admin } = await createSimHarness(world, software);
      const parked = await simParkedAtCheck(world, {
        harnessId: harness.id,
        admin,
        title: 'Check it',
      });
      const caller = simCaller(world, admin);
      const view = viewOf(await world.kernel.gates.view(caller, { itemId: parked.itemId }));
      expect(view).toMatchObject({ stageKey: 'check', connector: 'none', ship: null });
    } finally {
      await world.close();
    }
  });
});

describe('the gate view is a read for people', () => {
  sceneIt("refuses an agent's gate view not_permitted and records nothing", async (scene) => {
    const agent = simAgent(scene.ian, `${scene.ian.personId}/builder`, { interactive: true });
    const before = await itemLog(scene.world, scene.harnessId, scene.itemId);
    const outcome = await scene.world.kernel.gates.view(simCaller(scene.world, agent), {
      itemId: scene.itemId,
    });
    expect(outcome).toMatchObject({ status: 'error', reason: 'not_permitted' });
    expect(await itemLog(scene.world, scene.harnessId, scene.itemId)).toEqual(before);
  });
});
