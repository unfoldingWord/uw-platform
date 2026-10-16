import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { simAgent, simCaller, simPerson } from '../fixtures.ts';
import { reviewWorld, type ReviewWorld } from '../review-runs.ts';
import { itemEvents, reasonOf, value } from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const findings = [
  { text: 'The board change drops the empty state.', weight: 'real' as const },
  { text: 'A year of clock skew breaks the lease.', weight: 'theoretical' as const },
];

async function reviewed(work: (scene: ReviewWorld) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const scene = await reviewWorld(world);
    const input = {
      verdict: 'request_changes' as const,
      findings,
      resolvedProvider: 'deepinfra',
      resolvedModel: 'z-ai/glm-5.3',
    };
    value(await world.kernel.runs.postReview(scene.host, scene.runId, input));
    await work(scene);
  } finally {
    await world.close();
  }
}

function refute(scene: ReviewWorld, finding: number, actor = scene.admin, itemId = scene.itemId) {
  const input = { itemId, runId: scene.runId, finding };
  return scene.world.kernel.gates.refuteFinding(simCaller(scene.world, actor), input);
}

async function marks(scene: ReviewWorld, itemId: string) {
  return (await itemEvents(scene, itemId)).filter((event) => event.name === 'finding_refuted');
}

async function outsiderRefused(scene: ReviewWorld): Promise<void> {
  const viewer = await simPerson(scene.world, 9, [
    { role: 'viewer', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const elsewhere = await simPerson(scene.world, 10, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '10-19' },
  ]);
  expect(reasonOf(await refute(scene, 1, viewer))).toBe('not_permitted');
  expect(reasonOf(await refute(scene, 1, elsewhere))).toBe('not_permitted');
  expect(await marks(scene, scene.itemId)).toEqual([]);
}

async function foreignRunRefused(scene: ReviewWorld): Promise<void> {
  const { world, admin, harnessId } = scene;
  const enqueued = await world.kernel.items.enqueue(simCaller(world, admin), {
    harnessId,
    title: 'Show the flow',
    pageId: null,
    priority: 2,
    due: null,
    delegationId: null,
  });
  const other = value(enqueued).itemId;
  expect(reasonOf(await refute(scene, 1, admin, other))).toBe('malformed_command');
  expect(await marks(scene, other)).toEqual([]);
  expect(await marks(scene, scene.itemId)).toEqual([]);
}

async function recordedOnce(scene: ReviewWorld): Promise<void> {
  expect(value(await refute(scene, 1))).toEqual({ recorded: true });
  expect(value(await refute(scene, 1))).toEqual({ recorded: false });
  const marks = (await itemEvents(scene, scene.itemId)).filter(
    (event) => event.name === 'finding_refuted',
  );
  expect(marks.map((event) => event.evidence)).toEqual([
    {
      runId: scene.runId,
      persona: 'agent:reviewer',
      reviewer: 'uw-reviewer',
      index: 1,
      weight: 'theoretical',
      text: 'A year of clock skew breaks the lease.',
    },
  ]);
}

async function rateShown(scene: ReviewWorld): Promise<void> {
  value(await refute(scene, 1));
  value(await refute(scene, 1));
  const caller = simCaller(scene.world, scene.admin);
  const dashboard = value(await scene.world.kernel.views.persona(caller, { pageId: scene.pageId }));
  expect(dashboard.refutes).toEqual({ findings: 2, refuted: 1, capped: false });
  const totals = await scene.world.kernel.views.planeTotals();
  expect(totals.reviewerRefutes.tallies).toEqual([
    {
      harnessId: scene.harnessId,
      harnessKey: 'software',
      persona: 'agent:reviewer',
      findings: 2,
      refuted: 1,
    },
  ]);
}

describe('RV-2 a person marks a finding refuted', () => {
  it('RV-2 records finding_refuted once, with the finding, and a second mark records nothing', () =>
    reviewed(recordedOnce));

  it('RV-2 refuses an agent and a finding the run did not write', () =>
    reviewed(async (scene) => {
      const agent = simAgent(scene.admin, 'builder', { interactive: true });
      expect(reasonOf(await refute(scene, 1, agent))).toBe('not_permitted');
      expect(reasonOf(await refute(scene, 7))).toBe('malformed_command');
    }));

  it("RV-2 refuses a person without write on the item's area, a viewer or an editor elsewhere", () =>
    reviewed(outsiderRefused));

  it('RV-2 refuses a run that belongs to another item and records nothing on either', () =>
    reviewed(foreignRunRefused));

  it('RV-2 shows the 30-day refute rate on the persona view and in the agent plane, counting a finding refuted twice once', () =>
    reviewed(rateShown));
});
