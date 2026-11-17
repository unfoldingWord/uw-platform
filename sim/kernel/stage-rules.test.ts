import type { Harness, HarnessEvent, Stage, StageRules } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { checkOnly, readAllEvents, type Caller } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;
const unknownId = '00000000-0000-4000-8000-0000000009f1';

type Scene = {
  readonly world: World;
  readonly harness: Harness;
  readonly stages: readonly Stage[];
  readonly rowan: Caller;
  readonly member: Caller;
};

async function withScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, stages, admin } = await createSimHarness(world, checkOnly);
    const member = await simPerson(world, 3, [{ role: 'editor', ...area }]);
    await work({
      world,
      harness,
      stages,
      rowan: simCaller(world, admin),
      member: simCaller(world, member),
    });
  } finally {
    await world.close();
  }
}

function rulesOf(stage: Stage, change: Partial<StageRules> = {}): StageRules {
  return {
    id: stage.id,
    agentPickup: stage.agentPickup,
    exitGate: stage.exitGate,
    wipLimit: stage.wipLimit,
    instructionsPageId: stage.instructionsPageId,
    validators: stage.validators,
    ...change,
  };
}

function stageAt(scene: Scene, key: string): Stage {
  const stage = scene.stages.find((entry) => entry.key === key);
  if (stage === undefined) throw new Error(`no ${key} stage`);
  return stage;
}

const live = (scene: Scene) =>
  scene.world.adapters.store.transaction((tx) =>
    tx.harnessStages.read.forHarness(scene.harness.id),
  );

function events(scene: Scene): Promise<readonly HarnessEvent[]> {
  return scene.world.adapters.store.transaction((tx) => readAllEvents(tx, scene.harness.id, null));
}

function save(scene: Scene, caller: Caller, stages: readonly StageRules[]) {
  return scene.world.kernel.stages.setStageRules(caller, { harnessId: scene.harness.id, stages });
}

async function appliesAtOnce(scene: Scene): Promise<void> {
  const check = stageAt(scene, 'check');
  const saved = await save(scene, scene.rowan, [
    rulesOf(check, { agentPickup: 'none', wipLimit: 7 }),
  ]);
  expect(saved.status).toBe('accepted');
  const now = (await live(scene)).find((stage) => stage.id === check.id);
  expect(now).toMatchObject({ agentPickup: 'none', wipLimit: 7, title: check.title });
  const edited = (await events(scene)).filter((event) => event.name === 'stage_edited');
  expect(edited).toHaveLength(1);
  expect(edited[0]?.actor).toBe(scene.rowan.actor.identity);
  expect(edited[0]?.evidence).toMatchObject({ key: 'check', after: { agentPickup: 'none' } });
}

async function refusesAProblem(scene: Scene): Promise<void> {
  const ship = stageAt(scene, 'ship');
  const before = await live(scene);
  const refused = await save(scene, scene.rowan, [rulesOf(ship, { exitGate: 'checks' })]);
  expect(refused).toMatchObject({ status: 'error', reason: 'stage_rules_have_problems' });
  expect(await live(scene)).toEqual(before);
}

async function refusesWhileADraftIsOpen(scene: Scene): Promise<void> {
  await scene.world.kernel.drafts.open(scene.rowan, { harnessId: scene.harness.id });
  const check = stageAt(scene, 'check');
  const refused = await save(scene, scene.rowan, [rulesOf(check, { wipLimit: 4 })]);
  expect(refused).toMatchObject({ status: 'error', reason: 'draft_locked' });
}

async function refusesAgentsAndMembers(scene: Scene): Promise<void> {
  const agent = simCaller(
    scene.world,
    simAgent(scene.rowan.actor, 'builder', { interactive: false }),
  );
  const rules = [rulesOf(stageAt(scene, 'check'), { wipLimit: 4 })];
  expect(await save(scene, agent, rules)).toMatchObject({ reason: 'not_permitted' });
  expect(await save(scene, scene.member, rules)).toMatchObject({ reason: 'not_permitted' });
}

async function refusesAnUnknownStageOrPage(scene: Scene): Promise<void> {
  const check = stageAt(scene, 'check');
  const stranger = rulesOf(check, { id: unknownId });
  expect(await save(scene, scene.rowan, [stranger])).toMatchObject({
    reason: 'malformed_command',
  });
  const page = rulesOf(check, { instructionsPageId: unknownId });
  expect(await save(scene, scene.rowan, [page])).toMatchObject({ reason: 'page_not_found' });
}

async function readsTheControls(scene: Scene): Promise<void> {
  const harnessId = scene.harness.id;
  const asAdmin = await scene.world.kernel.views.stageControls(scene.rowan, { harnessId });
  expect(asAdmin).toMatchObject({
    status: 'accepted',
    value: { admin: true, draft: null, harness: { id: harnessId }, skillPages: [] },
  });
  if (asAdmin.status !== 'accepted') return;
  expect(asAdmin.value.stages.map((stage) => stage.key)).toEqual(['check', 'ship']);
  expect(asAdmin.value.validators.length).toBeGreaterThan(0);
  await scene.world.kernel.drafts.open(scene.rowan, { harnessId });
  const asMember = await scene.world.kernel.views.stageControls(scene.member, { harnessId });
  expect(asMember).toMatchObject({ status: 'accepted', value: { admin: false } });
  if (asMember.status !== 'accepted') return;
  expect(asMember.value.draft?.personId).toBe(scene.rowan.actor.personId);
}

describe('#108 an area admin changes stage rules at once, checked like a publish', () => {
  it('reads the rules, switches and choices, and who may change them', () =>
    withScene(readsTheControls));

  it('applies a pickup and limit change and records who made it', () => withScene(appliesAtOnce));

  it('refuses a change the check finds a problem in, and changes nothing', () =>
    withScene(refusesAProblem));

  it('refuses while a draft is open, so the draft cannot go stale', () =>
    withScene(refusesWhileADraftIsOpen));

  it('refuses an agent and a team member', () => withScene(refusesAgentsAndMembers));

  it('refuses a stage that is not in this workflow and an unknown page', () =>
    withScene(refusesAnUnknownStageOrPage));
});
