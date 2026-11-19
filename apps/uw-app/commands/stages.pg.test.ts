import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { bml } from '@uw/harness';
import { agentOf, kernelOn, personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import {
  accepted,
  callerOf,
  command,
  dispatchAs,
  dispatchScope,
  eventCount,
  eventsNamed,
  rowan,
  softwareHarness,
  type Person,
} from '../testing/commands.ts';

const ROWAN_ID = '00000000-0000-4000-8000-000000000001';
const ROWAN = { email: 'rowan.test@unfoldingword.org' };

type Who = Pick<Person, 'email'>;

function send(db: Database, who: Who, harnessId: string, name: string, body: object) {
  return command(db, who, harnessId, name, { requestId: randomUUID(), ...body });
}

function activation(overrides: Record<string, unknown> = {}) {
  return {
    harnessKey: 'bml-board',
    jdArea: '30-39',
    template: 'bml',
    repository: null,
    ...overrides,
  };
}

async function sceneOf(db: Database, harnessId: string) {
  const kernel = kernelOn(db, { now: () => new Date() });
  return accepted(await kernel.reads.harness(callerOf(await rowan(db)), { harnessId }));
}

async function stageKeys(db: Database, harnessId: string): Promise<string[]> {
  const { stages } = await sceneOf(db, harnessId);
  return [...stages].sort((a, b) => a.position - b.position).map((stage) => stage.key);
}

async function harnessCount(db: Database): Promise<number> {
  const rows = await db.$client`SELECT count(*)::int AS n FROM harnesses`;
  return Number(rows[0]?.n);
}

async function areaAdmin(db: Database, area: string): Promise<Person> {
  const admin = { id: randomUUID(), email: `aa-${area}@unfoldingword.org`, grantId: randomUUID() };
  await seedPerson(db, { id: admin.id, email: admin.email });
  await seedGrant(db, {
    id: admin.grantId,
    personId: admin.id,
    role: 'admin',
    scopeKind: 'jd_area',
    scopeArea: area,
    grantedAt: new Date(Date.now() - 60_000),
    expiresAt: null,
  });
  return admin;
}

async function activates(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const harnessId = randomUUID();
  const requestId = randomUUID();
  const body = { requestId, ...activation() };
  const sent = await command(db, ROWAN, harnessId, 'activate_template', body);
  expect(sent.body).toEqual({ status: 'accepted', requestId });
  expect((await sceneOf(db, harnessId)).harness).toMatchObject({
    key: 'bml-board',
    template: 'bml',
    jdArea: '30-39',
    repository: null,
  });
  expect(await stageKeys(db, harnessId)).toEqual(bml.stages.map((stage) => stage.key));
  const [event] = await eventsNamed(db, harnessId, 'template_activated');
  expect(event).toMatchObject({ actor: `human:${ROWAN_ID}`, requestId, traceId: sent.traceId });
  const again = await send(
    db,
    ROWAN,
    harnessId,
    'activate_template',
    activation({ harnessKey: 'b' }),
  );
  expect(again.body).toMatchObject({ status: 'error', reason: 'harness_exists' });
  const editorBody = activation({ harnessKey: 'ed-board', jdArea: '80-89' });
  const editor = await send(db, scene.editor, randomUUID(), 'activate_template', editorBody);
  expect(editor.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  expect(await harnessCount(db)).toBe(3);
}

function conflicting(harnessId: string): ReadonlyArray<readonly [string, object]> {
  return [
    [harnessId, activation({ harnessKey: 'aa-one' })],
    [randomUUID(), activation({ harnessKey: 'software' })],
    [randomUUID(), activation({ harnessKey: 'aa-two', repository: 'UnfoldingWord/UW-Platform' })],
    [randomUUID(), activation({ harnessKey: 'aa-three' })],
  ];
}

async function answersFor(db: Database, who: Who, harnessId: string): Promise<Set<string>> {
  const answers = new Set<string>();
  for (const [target, body] of conflicting(harnessId)) {
    const requestId = randomUUID();
    const sent = await command(db, who, target, 'activate_template', { requestId, ...body });
    expect(sent.body).toEqual({ status: 'error', requestId, reason: 'not_permitted' });
    answers.add(`${sent.status} ${sent.text.replace(requestId, '')}`);
  }
  return answers;
}

async function hidesWhatItCannotRead(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  for (const who of [scene.stranger, scene.viewer, scene.editor]) {
    expect((await answersFor(db, who, scene.harnessId)).size).toBe(1);
  }
  expect(await harnessCount(db)).toBe(2);
  const admin = await areaAdmin(db, '30-39');
  const taken = await send(db, admin, randomUUID(), 'activate_template', {
    ...activation({ harnessKey: 'software' }),
  });
  expect(taken.body).toMatchObject({ status: 'error', reason: 'harness_exists' });
  const kernel = kernelOn(db, { now: () => new Date() });
  const reader = await personOn(db, admin.id, admin.email, new Date());
  const read = await kernel.reads.harness(callerOf(reader), { harnessId: scene.harnessId });
  expect(read).toMatchObject({ status: 'error', reason: 'harness_not_found' });
}

async function pausesAndResumes(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const { harnessId } = scene;
  const requestId = randomUUID();
  const paused = await command(db, ROWAN, harnessId, 'pause', { requestId, stageKey: null });
  expect(paused.body).toEqual({ status: 'accepted', requestId });
  expect((await send(db, ROWAN, harnessId, 'pause', { stageKey: null })).body).toMatchObject({
    status: 'accepted',
  });
  expect((await send(db, ROWAN, harnessId, 'pause', { stageKey: 'build' })).body).toMatchObject({
    status: 'accepted',
  });
  expect((await send(db, ROWAN, harnessId, 'resume', { stageKey: null })).body).toMatchObject({
    status: 'accepted',
  });
  const editor = await send(db, scene.editor, harnessId, 'resume', { stageKey: 'build' });
  expect(editor.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const pauses = await eventsNamed(db, harnessId, 'harness_paused');
  expect(pauses.map((event) => event.evidence)).toEqual([{ stage: null }, { stage: 'build' }]);
  expect(pauses[0]).toMatchObject({ actor: `human:${ROWAN_ID}`, requestId });
  const resumes = await eventsNamed(db, harnessId, 'harness_resumed');
  expect(resumes.map((event) => event.evidence)).toEqual([{ stage: null }]);
  const after = await sceneOf(db, harnessId);
  expect(after.harness.paused).toBe(false);
  expect(after.stages.find((stage) => stage.key === 'build')?.paused).toBe(true);
}

async function freezesForAnAdmin(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const requestId = randomUUID();
  const body = { requestId, frozen: true, allow: [] };
  const byAdmin = await command(db, ROWAN, scene.harnessId, 'set_freeze', body);
  expect(byAdmin.body).toEqual({ status: 'accepted', requestId });
  const [frozen] = await eventsNamed(db, scene.harnessId, 'freeze_changed');
  expect(frozen).toMatchObject({ evidence: { frozen: true, allow: [] }, requestId });
  expect((await sceneOf(db, scene.harnessId)).harness).toMatchObject({ frozen: true });
  const lift = { requestId: randomUUID(), frozen: false, allow: [] };
  const byEditor = await command(db, scene.editor, scene.harnessId, 'set_freeze', lift);
  expect(byEditor.body).toEqual({
    status: 'error',
    requestId: lift.requestId,
    reason: 'not_permitted',
  });
  expect(await eventsNamed(db, scene.harnessId, 'freeze_changed')).toHaveLength(1);
}

async function rulesOf(db: Database, harnessId: string, key: string) {
  const { stages } = await sceneOf(db, harnessId);
  const stage = stages.find((entry) => entry.key === key);
  if (stage === undefined) throw new Error(`no ${key} stage`);
  const { id, agentPickup, exitGate, wipLimit, instructionsPageId, validators } = stage;
  return { id, agentPickup, exitGate, wipLimit, instructionsPageId, validators };
}

async function setsStageRules(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const { harnessId } = scene;
  const build = await rulesOf(db, harnessId, 'build');
  const change = { stages: [{ ...build, agentPickup: 'none', wipLimit: 5 }] };
  const requestId = randomUUID();
  const saved = await command(db, ROWAN, harnessId, 'set_stage_rules', { requestId, ...change });
  expect(saved.body).toEqual({ status: 'accepted', requestId });
  expect(await rulesOf(db, harnessId, 'build')).toMatchObject({ agentPickup: 'none', wipLimit: 5 });
  const [edited] = await eventsNamed(db, harnessId, 'stage_edited');
  expect(edited).toMatchObject({
    actor: `human:${ROWAN_ID}`,
    requestId,
    evidence: { key: 'build' },
  });
  const byEditor = await send(db, scene.editor, harnessId, 'set_stage_rules', change);
  expect(byEditor.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
}

async function turnsShadowOnAndOff(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const { harnessId } = scene;
  const on = await send(db, ROWAN, harnessId, 'set_shadow', { shadow: true });
  expect(on.body).toMatchObject({ status: 'accepted' });
  expect((await sceneOf(db, harnessId)).harness.shadow).toBe(true);
  const byEditor = await send(db, scene.editor, harnessId, 'set_shadow', { shadow: false });
  expect(byEditor.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  await send(db, ROWAN, harnessId, 'set_shadow', { shadow: false });
  expect(await eventsNamed(db, harnessId, 'shadow_turned_on')).toHaveLength(1);
  expect(await eventsNamed(db, harnessId, 'shadow_lifted')).toHaveLength(1);
}

function agentAttempts(harnessId: string): ReadonlyArray<readonly [string, string, object]> {
  return [
    [randomUUID(), 'activate_template', activation({ harnessKey: 'agent-board' })],
    [harnessId, 'pause', { stageKey: null }],
    [harnessId, 'resume', { stageKey: null }],
    [harnessId, 'set_freeze', { frozen: true, allow: [] }],
    [harnessId, 'set_shadow', { shadow: true }],
  ];
}

async function agentsRefused(db: Database): Promise<void> {
  const { harnessId } = await softwareHarness(db);
  const agent = agentOf(await rowan(db), 'builder');
  const scope = dispatchScope(db);
  const before = await eventCount(db, harnessId);
  for (const [target, name, body] of agentAttempts(harnessId)) {
    const requestId = randomUUID();
    const outcome = await dispatchAs(agent, target, name, { requestId, ...body }, scope);
    expect(outcome).toEqual({ status: 'error', requestId, reason: 'not_permitted' });
  }
  expect(await eventCount(db, harnessId)).toBe(before);
  expect(await harnessCount(db)).toBe(2);
}

describe.skipIf(!testServer)('WB-1 KN-18 the stage command on the person surface', () => {
  it('WB-1 activate_template creates the harness named in the path from a template, for an admin of the body area', () =>
    withAppDatabase(activates));

  it("activate_template answers a person who cannot administer the area not_permitted alike whether the id, key or repository is taken or free, and harness_exists only to an admin, since keys are unique across areas, though the admin cannot read the other area's harness", () =>
    withAppDatabase(hidesWhatItCannotRead));

  it('WB-1 pause and resume through the command API record harness_paused and harness_resumed', () =>
    withAppDatabase(pausesAndResumes));

  it('GD-2 set_freeze freezes for an admin, is refused for an editor, and records freeze_changed', () =>
    withAppDatabase(freezesForAnAdmin));

  it('#108 set_stage_rules changes a stage at once for an admin, records who, and refuses an editor', () =>
    withAppDatabase(setsStageRules));

  it('#108 set_shadow turns shadow on and off for an admin and refuses an editor', () =>
    withAppDatabase(turnsShadowOnAndOff));

  it('the stage command refuses an agent on every route and records nothing', () =>
    withAppDatabase(agentsRefused));
});
