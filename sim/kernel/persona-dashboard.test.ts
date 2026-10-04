import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { newEventSchema, type Identity } from '@uw/contracts';
import type { RunRow } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { simCaller, simPerson } from '../fixtures.ts';
import { readSpend } from '../fixtures.ts';
import {
  builderFrontmatter,
  runWorld,
  seedPersona,
  startOn,
  systemCaller,
  value,
  type RunWorld,
} from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const suggestedPage = '00000000-0000-4000-8000-000000009701';
const builder = 'agent:builder' as Identity;

async function inWorld(work: (scene: RunWorld) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await runWorld(world));
  } finally {
    await world.close();
  }
}

function dashboardOf(scene: RunWorld, who = scene.admin, pageId = scene.pageId) {
  const caller = simCaller(scene.world, who);
  return scene.world.kernel.views.persona(
    caller,
    { pageId },
    { at: scene.world.adapters.clock.now() },
  );
}

function externalRun(scene: RunWorld): RunRow {
  const now = scene.world.adapters.clock.now();
  const step = {
    step: 'work' as const,
    tokensIn: 300,
    tokensOut: 200,
    costMinor: null,
    computeMinor: null,
    model: null,
    resolvedProvider: null,
    toolsCalled: [],
    writes: 4,
    at: now.toISOString(),
  };
  return {
    id: scene.world.adapters.ids.next(),
    harnessId: scene.harnessId,
    itemId: scene.itemId,
    persona: builder,
    personaPageId: scene.pageId,
    delegationId: null,
    runShape: 'external-run',
    engine: 'external',
    model: 'external',
    pinnedProvider: null,
    resolvedProvider: null,
    steps: [step],
    costMinor: null,
    computeMinor: null,
    costBasis: 'subscription',
    traceId: scene.world.adapters.ids.next(),
    outcome: 'failed',
    hibernatedFor: null,
    failure: 'retries_exhausted',
    gates: [],
    prompts: [],
    startedAt: now,
    endedAt: now,
  };
}

function refusedGate(scene: RunWorld) {
  return newEventSchema.parse({
    eventId: scene.world.adapters.ids.next(),
    harnessId: scene.harnessId,
    itemId: scene.itemId,
    name: 'gate_refused_to_agent',
    at: scene.world.adapters.clock.now().toISOString(),
    actor: builder,
    evidence: { stage: 'scope', decision: 'approve' },
    traceId: scene.world.adapters.ids.next(),
    requestId: null,
  });
}

async function heldOnce(scene: RunWorld): Promise<void> {
  await readSpend(scene.world);
  const { runId } = value(await startOn(scene));
  const reason = 'the premise names a file that no longer exists';
  value(await scene.world.kernel.runs.holdPremise(systemCaller(scene), runId, { reason }));
}

async function figures(scene: RunWorld): Promise<void> {
  await heldOnce(scene);
  await scene.world.adapters.store.transaction(async (tx) => {
    await tx.harnessRuns.write.insert(externalRun(scene));
    await tx.harnessEvents.write.append([refusedGate(scene)]);
  });
  const dashboard = value(await dashboardOf(scene));
  expect(dashboard.runsToday).toEqual({
    total: 2,
    byHost: { platform: 1, external: 1 },
    byEngine: { 'claude-messages': 1, external: 1 },
  });
  expect(dashboard.spend).toMatchObject({ subscriptionTokens: 500, currency: 'USD' });
  expect(dashboard.escalation).toEqual({ ended: 2, escalated: 2 });
  expect(dashboard.gateRefusals).toBe(1);
  expect(dashboard.writes).toBe(4);
  expect(dashboard.lastRuns.map((run) => run.runShape)).toEqual(
    expect.arrayContaining(['workflow-run', 'external-run']),
  );
  expect(dashboard.today).toBe('2026-10-01');
}

async function delegationsShown(scene: RunWorld): Promise<void> {
  const admin = value(await dashboardOf(scene, scene.owner));
  expect(admin.delegations.count).toBe(1);
  expect(admin.delegations.live?.map((entry) => entry.id)).toEqual([scene.delegationId]);
  const editor = await simPerson(scene.world, 7, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  expect(value(await dashboardOf(scene, editor)).delegations).toEqual({ count: 1, live: null });
}

async function manyDelegations(scene: RunWorld): Promise<void> {
  const now = scene.world.adapters.clock.now();
  await scene.world.adapters.store.transaction(async (tx) => {
    for (let n = 1; n <= 52; n += 1) {
      await tx.delegations.write.insert(
        {
          id: scene.world.adapters.ids.next(),
          personId: scene.owner.personId ?? '',
          persona: builder,
          harnessId: scene.harnessId,
          capability: 'build',
          grantedAt: new Date(now.getTime() + n),
          expiresAt: new Date(now.getTime() + 86_400_000),
          revokedAt: null,
          lapsedAt: null,
          supersedes: null,
        },
        scene.world.adapters.ids.next(),
      );
    }
  });
  const admin = value(await dashboardOf(scene, scene.owner));
  expect(admin.delegations.count).toBe(53);
  expect(admin.delegations.live).toHaveLength(50);
  expect(admin.delegations.live?.[0]?.id).toBe(scene.delegationId);
}

async function hidden(scene: RunWorld): Promise<void> {
  const stranger = await simPerson(scene.world, 7, [
    { role: 'viewer', scopeKind: 'jd_area', scopeArea: '30-39' },
  ]);
  const missing = scene.world.adapters.ids.next();
  expect(await dashboardOf(scene, stranger)).toEqual({
    status: 'error',
    reason: 'page_not_found',
    detail: { pageId: scene.pageId },
  });
  expect(await dashboardOf(scene, scene.admin, missing)).toEqual({
    status: 'error',
    reason: 'page_not_found',
    detail: { pageId: missing },
  });
  const agent = simCaller(scene.world, scene.persona);
  const at = { at: scene.world.adapters.clock.now() };
  const byAgent = await scene.world.kernel.views.persona(agent, { pageId: scene.pageId }, at);
  expect(byAgent).toMatchObject({ status: 'error', reason: 'not_permitted' });
}

async function premisesCounted(scene: RunWorld): Promise<void> {
  await heldOnce(scene);
  expect(value(await dashboardOf(scene)).premisesHeld).toBe(1);
  const other = builderFrontmatter(scene, { identity: 'agent:other-builder' });
  await seedPersona(scene, { id: suggestedPage, frontmatter: other });
  expect(value(await dashboardOf(scene, scene.admin, suggestedPage)).premisesHeld).toBe(0);
}

async function activateOffered(scene: RunWorld): Promise<void> {
  const other = builderFrontmatter(scene, { identity: 'agent:other-builder' });
  await seedPersona(scene, { id: suggestedPage, status: 'suggested', frontmatter: other });
  expect(value(await dashboardOf(scene, scene.admin, suggestedPage)).canActivate).toBe(true);
  expect(value(await dashboardOf(scene, scene.admin)).canActivate).toBe(false);
  const editor = await simPerson(scene.world, 7, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const byEditor = value(await dashboardOf(scene, editor, suggestedPage));
  expect([byEditor.canActivate, byEditor.toolsetOptions?.includes('write_page')]).toEqual([
    false,
    true,
  ]);
  const viewer = await simPerson(scene.world, 8, [
    { role: 'viewer', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const byViewer = value(await dashboardOf(scene, viewer, suggestedPage));
  expect([byViewer.canActivate, byViewer.toolsetOptions]).toEqual([false, null]);
}

async function playLinks(scene: RunWorld): Promise<void> {
  await heldOnce(scene);
  const at = { at: scene.world.adapters.clock.now() };
  const caller = simCaller(scene.world, scene.admin);
  const play = value(
    await scene.world.kernel.views.playByPlay(caller, { itemId: scene.itemId, after: 0 }, at),
  );
  expect(play.personaPages).toEqual({ [builder]: scene.pageId });
}

describe('the persona dashboard', () => {
  it("the play-by-play names the page of each persona actor, so a persona's dashboard is one link away", () =>
    inWorld(playLinks));
  it('PE-4 the dashboard shows runs today by host and engine, spend with subscription tokens apart, escalation rate, gate refusals, writes and the last runs', () =>
    inWorld(figures));
  it('PE-4 the dashboard lists the delegations the persona runs under to an admin and counts them for others', () =>
    inWorld(delegationsShown));
  it('the dashboard lists at most 50 live delegations and counts them all', () =>
    inWorld(manyDelegations));
  it('PE-4 a persona page the caller cannot read, or of a harness they cannot read, is page_not_found', () =>
    inWorld(hidden));
  it('PE-5 held premises are counted per persona on its dashboard', () => inWorld(premisesCounted));
  it("PE-3 Activate is offered only to a person holding admin on the harness's area, and only while the persona is suggested", () =>
    inWorld(activateOffered));
});
