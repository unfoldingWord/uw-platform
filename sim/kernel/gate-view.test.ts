import {
  gateViewSchema,
  identitySchema,
  principalSchema,
  type GateDecision,
  type GateView,
  type Principal,
  type PullRequestDeclaration,
} from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import {
  notWiredCall,
  createKernel,
  software,
  type GitHubFacts,
  type KernelOutcome,
  type PullRequestFacts,
  type ReviewFact,
} from '@uw/harness';
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

const missingId = '00000000-0000-4000-8000-0000000000ff';

function agentOf(owner: Principal, identity: string, interactive: boolean): Principal {
  return principalSchema.parse({ ...owner, identity, kind: 'agent', email: null, interactive });
}

async function hiddenLikeMissing(scene: Scene, actor: Principal): Promise<void> {
  const caller = simCaller(scene.world, actor);
  const hidden = await scene.world.kernel.gates.view(caller, { itemId: scene.itemId });
  const missing = await scene.world.kernel.gates.view(caller, { itemId: missingId });
  expect(missing).toEqual({
    status: 'error',
    reason: 'item_not_found',
    detail: { itemId: missingId },
  });
  expect(JSON.stringify(hidden).replace(scene.itemId, missingId)).toBe(JSON.stringify(missing));
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

describe('the gate view answers from the read model', () => {
  sceneIt('makes no refresh call', async (scene) => {
    const sim = scene.world.adapters.githubFacts;
    let refreshes = 0;
    const githubFacts: GitHubFacts = {
      pullRequest: (ref) => sim.pullRequest(ref),
      refresh: (ref) => {
        refreshes += 1;
        return sim.refresh(ref);
      },
      diff: () => notWiredCall('githubFacts', 'diff'),
    };
    const kernel = createKernel({ ...scene.world.adapters, githubFacts });
    const view = viewOf(
      await kernel.gates.view(simCaller(scene.world, scene.ian), { itemId: scene.itemId }),
    );
    expect(view.facts?.head).toBe(head);
    expect(refreshes).toBe(0);
  });
});

describe('the gate view of a hidden item is item_not_found like a missing one', () => {
  sceneIt('answers a stranger as it answers an unknown item', async (scene) => {
    await hiddenLikeMissing(scene, await simPerson(scene.world, 3, []));
  });

  sceneIt('answers every agent form that may not read the harness as missing', async (scene) => {
    const { ian } = scene;
    const runner = agentOf(ian, `agent:${ian.personId ?? ''}/runner`, false);
    const persona = agentOf(ian, 'agent:builder', true);
    const lapsed = agentOf(
      ian,
      `agent:${ian.personId ?? ''}/laptop as builder via delegation:${missingId}`,
      false,
    );
    const foreign: Principal = {
      ...ian,
      identity: identitySchema.parse(`agent:${missingId}/laptop`),
      kind: 'agent',
      email: null,
    };
    for (const actor of [runner, persona, lapsed, foreign]) await hiddenLikeMissing(scene, actor);
  });
});

describe('the gate view of an item not at a connector stage has ship null', () => {
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

function factsClosing(scene: Scene, count: number): PullRequestFacts {
  const closes = [...Array.from({ length: count }).keys()].map((index) => `#${index + 1}`);
  const reviews = [approvedBy('uw-reviewer[bot]', 'anthropic', head, 9100000101)];
  return greenFacts(scene.world, {
    itemId: scene.itemId,
    head,
    reviews,
    paths: aclChange.paths,
    declaration: { ...parsedDeclaration, closes },
  });
}

describe('GH-5 a declaration closing more issues than the limit counts as undeclared in the view and at Ship', () => {
  sceneIt('shows no declaration and the same refusal an approve records', async (scene) => {
    scene.world.adapters.githubFacts.given(factsClosing(scene, 51));
    const caller = simCaller(scene.world, scene.ian);
    const view = viewOf(await scene.world.kernel.gates.view(caller, { itemId: scene.itemId }));
    expect(view.facts?.declaration).toBeNull();
    expect(view.ship?.outcome).toMatchObject({ verdict: 'refuse' });
    expect(view.ship?.outcome).toEqual(
      expect.objectContaining({ reasons: expect.arrayContaining(['risk_tier_undeclared']) }),
    );
    const decided = await scene.world.kernel.gates.decide(caller, {
      itemId: scene.itemId,
      decision: 'approve',
      reason: null,
      findings: [],
      seenHead: head,
    });
    expect(decided).toMatchObject({ status: 'error', reason: 'risk_tier_undeclared' });
    expect(view.ship?.outcome).toEqual(asOutcome(decided));
  });

  sceneIt('shows a declaration closing exactly the limit', async (scene) => {
    scene.world.adapters.githubFacts.given(factsClosing(scene, 50));
    const caller = simCaller(scene.world, scene.ian);
    const view = viewOf(await scene.world.kernel.gates.view(caller, { itemId: scene.itemId }));
    expect(view.facts?.declaration?.closes).toHaveLength(50);
  });
});

async function decideSeeing(
  scene: Scene,
  decision: GateDecision,
  seenHead: string | null | undefined,
) {
  const before = await itemLog(scene.world, scene.harnessId, scene.itemId);
  const outcome = await scene.world.kernel.gates.decide(simCaller(scene.world, scene.ian), {
    itemId: scene.itemId,
    decision,
    reason: decision === 'override' ? 'known risk' : null,
    findings: decision === 'reject' ? ['not yet'] : [],
    ...(seenHead === undefined ? {} : { seenHead }),
  });
  const after = await itemLog(scene.world, scene.harnessId, scene.itemId);
  return { outcome, wrote: after.events.length > before.events.length, after };
}

const otherHead = simSha('0b0e');

describe('KN-13 an approve or override must name the head the person saw', () => {
  sceneIt('refuses an approve that names no head and writes nothing', async (scene) => {
    const { outcome, wrote, after } = await decideSeeing(scene, 'approve', undefined);
    expect(outcome).toEqual({
      status: 'error',
      reason: 'malformed_command',
      detail: { why: 'seen_head_required' },
    });
    expect(wrote).toBe(false);
    expect(after.decisions).toEqual([]);
  });

  sceneIt('refuses an override that names no head and writes nothing', async (scene) => {
    const { outcome, wrote } = await decideSeeing(scene, 'override', undefined);
    expect(outcome).toMatchObject({ status: 'error', reason: 'malformed_command' });
    expect(wrote).toBe(false);
  });

  sceneIt(
    'refuses an override naming another head head_mismatch and writes nothing',
    async (scene) => {
      const { outcome, wrote, after } = await decideSeeing(scene, 'override', otherHead);
      expect(outcome).toEqual({
        status: 'error',
        reason: 'head_mismatch',
        detail: { why: 'not_the_head_you_saw', expectedHead: head },
      });
      expect(wrote).toBe(false);
      expect(after.decisions).toEqual([]);
    },
  );
});

describe('a reject or take-over does not depend on a seen head', () => {
  sceneIt('records a reject whatever head it names', async (scene) => {
    const { outcome, after } = await decideSeeing(scene, 'reject', otherHead);
    expect(outcome.status).toBe('accepted');
    expect(after.decisions).toEqual(['reject']);
  });

  sceneIt('records a take-over that names no head', async (scene) => {
    const { outcome, after } = await decideSeeing(scene, 'take_over', undefined);
    expect(outcome.status).toBe('accepted');
    expect(after.decisions).toEqual(['take_over']);
  });
});

function reviewBy(
  reviewer: string,
  commit: string,
  reviewId: number,
  change: Partial<ReviewFact>,
): ReviewFact {
  const submittedAt = new Date(Date.UTC(2026, 9, 1, 9, reviewId % 100));
  return { ...approvedBy(reviewer, 'openai', commit, reviewId, submittedAt), ...change };
}

const reviewerHistory: readonly ReviewFact[] = [
  reviewBy('uw-reviewer[bot]', head, 9100000201, { provider: 'Anthropic' }),
  reviewBy('uw-reviewer[bot]', head, 9100000202, {
    state: 'changes_requested',
    provider: 'Anthropic',
    findings: [
      { text: 'The grant is read after the append', weight: null },
      { text: 'A title names the wrong requirement', weight: null },
    ],
  }),
  reviewBy('uw-reviewer[bot]', head, 9100000203, {
    state: 'commented',
    findings: [{ text: 'a remark', weight: null }],
  }),
  reviewBy('uw-reviewer-codex[bot]', head, 9100000204, {
    findings: [{ text: 'A nit in the copy', weight: null }],
  }),
  reviewBy('uw-reviewer-codex[bot]', simSha('01d'), 9100000205, { state: 'changes_requested' }),
  reviewBy('someone-else[bot]', head, 9100000206, { state: 'changes_requested' }),
];

describe("WB-6 the gate view lists each Reviewer's latest review on the head with its findings", () => {
  sceneIt('keeps one decisive review per Reviewer identity on the usable head', async (scene) => {
    const { itemId } = scene;
    scene.world.adapters.githubFacts.given(
      greenFacts(scene.world, {
        itemId,
        head,
        reviews: reviewerHistory,
        paths: aclChange.paths,
        declaration: parsedDeclaration,
      }),
    );
    const caller = simCaller(scene.world, scene.ian);
    const view = viewOf(await scene.world.kernel.gates.view(caller, { itemId }));
    expect(view.reviews).toEqual([
      {
        reviewer: 'uw-reviewer',
        commit: head,
        state: 'changes_requested',
        provider: 'anthropic',
        findings: [
          { text: 'The grant is read after the append', weight: null },
          { text: 'A title names the wrong requirement', weight: null },
        ],
      },
      {
        reviewer: 'uw-reviewer-codex',
        commit: head,
        state: 'approved',
        provider: 'openai',
        findings: [{ text: 'A nit in the copy', weight: null }],
      },
    ]);
  });
});
