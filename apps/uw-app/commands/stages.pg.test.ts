import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { bml, software } from '@uw/harness';
import {
  gateDeps,
  kimEmail,
  parkedAtShip,
  readyToShip,
  shipWrites,
  type ParkedAtShip,
} from '../github/testing/gate-rig.ts';
import { decisionRows } from '../github/testing/ship-rig.ts';
import { agentOf, kernelOn, personOn } from '../testing/kernel.ts';
import { platformStore } from '../ports/store.ts';
import { kernelThatLosesTheExit } from '../testing/lost-exit.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import {
  accepted,
  callerOf,
  command,
  dispatchAs,
  dispatchScope,
  enqueued,
  eventCount,
  eventsNamed,
  ian,
  itemState,
  post,
  softwareHarness,
  type Person,
} from '../testing/commands.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';
const IAN = { email: 'ian.lindsley@unfoldingword.org' };

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

function spare(overrides: Record<string, unknown> = {}) {
  return {
    key: 'spare',
    title: 'Spare',
    position: 90,
    bracket: 'iterate',
    agentPickup: 'allowed',
    exitGate: 'checks',
    connector: 'none',
    wipLimit: 3,
    instructionsPageId: null,
    validators: [],
    feeds: [],
    ...overrides,
  };
}

async function sceneOf(db: Database, harnessId: string) {
  const kernel = kernelOn(db, { now: () => new Date() });
  return accepted(await kernel.reads.harness(callerOf(await ian(db)), { harnessId }));
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
  const sent = await command(db, IAN, harnessId, 'activate_template', body);
  expect(sent.body).toEqual({ status: 'accepted', requestId });
  expect((await sceneOf(db, harnessId)).harness).toMatchObject({
    key: 'bml-board',
    template: 'bml',
    jdArea: '30-39',
    repository: null,
  });
  expect(await stageKeys(db, harnessId)).toEqual(bml.stages.map((stage) => stage.key));
  const [event] = await eventsNamed(db, harnessId, 'template_activated');
  expect(event).toMatchObject({ actor: `human:${IAN_ID}`, requestId, traceId: sent.traceId });
  const again = await send(
    db,
    IAN,
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
  expect(read.status).toBe('accepted');
}

async function pausesAndResumes(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const { harnessId } = scene;
  const requestId = randomUUID();
  const paused = await command(db, IAN, harnessId, 'pause', { requestId, stageKey: null });
  expect(paused.body).toEqual({ status: 'accepted', requestId });
  expect((await send(db, IAN, harnessId, 'pause', { stageKey: null })).body).toMatchObject({
    status: 'accepted',
  });
  expect((await send(db, IAN, harnessId, 'pause', { stageKey: 'build' })).body).toMatchObject({
    status: 'accepted',
  });
  expect((await send(db, IAN, harnessId, 'resume', { stageKey: null })).body).toMatchObject({
    status: 'accepted',
  });
  const editor = await send(db, scene.editor, harnessId, 'resume', { stageKey: 'build' });
  expect(editor.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const pauses = await eventsNamed(db, harnessId, 'harness_paused');
  expect(pauses.map((event) => event.evidence)).toEqual([{ stage: null }, { stage: 'build' }]);
  expect(pauses[0]).toMatchObject({ actor: `human:${IAN_ID}`, requestId });
  const resumes = await eventsNamed(db, harnessId, 'harness_resumed');
  expect(resumes.map((event) => event.evidence)).toEqual([{ stage: null }]);
  const after = await sceneOf(db, harnessId);
  expect(after.harness.paused).toBe(false);
  expect(after.stages.find((stage) => stage.key === 'build')?.paused).toBe(true);
}

async function removesOnlyAnEmptyStage(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const { harnessId } = scene;
  await enqueued(db, harnessId, 'Hold the package stage');
  const before = await eventCount(db, harnessId);
  const holding = await send(db, IAN, harnessId, 'remove_stage', { stageKey: 'package' });
  expect(holding.body).toMatchObject({ status: 'error', reason: 'stage_not_empty' });
  const effect = await send(db, IAN, harnessId, 'remove_stage', { stageKey: 'ship' });
  expect(effect.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  expect(await eventCount(db, harnessId)).toBe(before);
  const created = await send(db, IAN, harnessId, 'create_stage', { stage: spare() });
  expect(created.body).toMatchObject({ status: 'accepted' });
  const editor = await send(db, scene.editor, harnessId, 'remove_stage', { stageKey: 'spare' });
  expect(editor.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const requestId = randomUUID();
  const removed = await command(db, IAN, harnessId, 'remove_stage', {
    requestId,
    stageKey: 'spare',
  });
  expect(removed.body).toEqual({ status: 'accepted', requestId });
  const [event] = await eventsNamed(db, harnessId, 'stage_removed');
  expect(event).toMatchObject({ requestId, evidence: { key: 'spare' } });
  expect(await stageKeys(db, harnessId)).not.toContain('spare');
}

async function createsAndReorders(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const { harnessId } = scene;
  const requestId = randomUUID();
  const created = await command(db, IAN, harnessId, 'create_stage', { requestId, stage: spare() });
  expect(created.body).toEqual({ status: 'accepted', requestId });
  const [edited] = await eventsNamed(db, harnessId, 'stage_edited');
  expect(edited).toMatchObject({ requestId, evidence: { key: 'spare', before: null } });
  const order = ['spare', ...software.stages.map((stage) => stage.key)];
  const reordered = await send(db, IAN, harnessId, 'reorder_stages', { order });
  expect(reordered.body).toMatchObject({ status: 'accepted' });
  expect(await stageKeys(db, harnessId)).toEqual(order);
  const editor = await send(db, scene.editor, harnessId, 'create_stage', {
    stage: spare({ key: 'other' }),
  });
  expect(editor.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  expect(await stageKeys(db, harnessId)).toEqual(order);
}

async function noEditBypassesShip(db: Database): Promise<void> {
  const { harnessId } = await softwareHarness(db);
  const before = await sceneOf(db, harnessId);
  const requestId = randomUUID();
  const lowered = await command(db, IAN, harnessId, 'update_stage', {
    requestId,
    stageKey: 'ship',
    change: { exitGate: 'checks' },
  });
  const unguarded = await send(db, IAN, harnessId, 'create_stage', {
    stage: spare({ connector: 'merge' }),
  });
  for (const sent of [lowered, unguarded]) {
    expect(sent.body).toMatchObject({ status: 'error', reason: 'stage_edit_refused' });
  }
  expect((await sceneOf(db, harnessId)).stages).toEqual(before.stages);
  const [recorded] = await eventsNamed(db, harnessId, 'stage_edit_refused');
  expect(recorded).toMatchObject({
    actor: `human:${IAN_ID}`,
    requestId,
    evidence: {
      stage: 'ship',
      reason: 'stage_edit_refused',
      constraint: 'harness_stages_effect_needs_human_gate',
    },
  });
  const paused = await send(db, IAN, harnessId, 'update_stage', {
    stageKey: 'build',
    change: { paused: true },
  });
  expect(paused.body).toMatchObject({ status: 'error', reason: 'malformed_command' });
}

function agentAttempts(harnessId: string): ReadonlyArray<readonly [string, string, object]> {
  return [
    [randomUUID(), 'activate_template', activation({ harnessKey: 'agent-board' })],
    [harnessId, 'create_stage', { stage: spare() }],
    [harnessId, 'update_stage', { stageKey: 'build', change: { title: 'Built' } }],
    [harnessId, 'reorder_stages', { order: ['package'] }],
    [harnessId, 'remove_stage', { stageKey: 'close' }],
    [harnessId, 'pause', { stageKey: null }],
    [harnessId, 'resume', { stageKey: null }],
  ];
}

async function agentsRefused(db: Database): Promise<void> {
  const { harnessId } = await softwareHarness(db);
  const agent = agentOf(await ian(db), 'builder');
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

async function shipStage(db: Database, parked: ParkedAtShip) {
  const { stages } = await sceneOf(db, parked.item.harnessId);
  const ship = stages.find((stage) => stage.key === 'ship');
  return { connector: ship?.connector, exitGate: ship?.exitGate };
}

function unshipped(db: Database, parked: ParkedAtShip) {
  return send(db, IAN, parked.item.harnessId, 'update_stage', {
    stageKey: 'ship',
    change: { connector: 'none' },
  });
}

async function connectorHeldWhileApprovalWaits(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const lost = await kernelThatLosesTheExit(db, parked.item.itemId);
  await expect(
    lost.gates.decide(callerOf(parked.kim), {
      itemId: parked.item.itemId,
      decision: 'approve',
      reason: null,
      findings: [],
      seenHead: parked.item.expectedHead,
    }),
  ).rejects.toThrow('the exit was lost');
  const requestId = randomUUID();
  const sent = await command(db, IAN, parked.item.harnessId, 'update_stage', {
    requestId,
    stageKey: 'ship',
    change: { connector: 'none' },
  });
  expect(sent.body).toEqual({ status: 'error', requestId, reason: 'decision_in_flight' });
  expect(await shipStage(db, parked)).toEqual({ connector: 'merge', exitGate: 'human_approval' });
  const renamed = await send(db, IAN, parked.item.harnessId, 'update_stage', {
    stageKey: 'ship',
    change: { title: 'Ship it' },
  });
  expect(renamed.body).toMatchObject({ status: 'accepted' });
}

async function onlyOpenItemsHoldTheConnector(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const lost = await kernelThatLosesTheExit(db, parked.item.itemId);
  await expect(
    lost.gates.decide(callerOf(parked.kim), {
      itemId: parked.item.itemId,
      decision: 'approve',
      reason: null,
      findings: [],
      seenHead: parked.item.expectedHead,
    }),
  ).rejects.toThrow('the exit was lost');
  await platformStore(db).transaction(async (tx) => {
    const row = await tx.harnessItems.read.lock(parked.item.itemId);
    if (row === null) throw new Error('the parked item vanished');
    await tx.harnessItems.write.project({ ...row, gateStatus: 'done' });
  });
  expect((await unshipped(db, parked)).body).toMatchObject({ status: 'accepted' });
}

async function shippedThrough(db: Database, parked: ParkedAtShip): Promise<void> {
  const github = readyToShip(parked.item.itemId);
  const path = `/api/harness/${parked.item.harnessId}/commands/approve`;
  const body = {
    command: 'approve',
    requestId: randomUUID(),
    itemId: parked.item.itemId,
    head: parked.item.expectedHead,
  };
  const sent = await post(db, kimEmail, path, body, await gateDeps(github));
  expect(sent.body).toMatchObject({ status: 'accepted' });
  expect(shipWrites(github)).not.toEqual([]);
}

async function historyHoldsAStage(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const { harnessId } = parked.item;
  const effect = await send(db, IAN, harnessId, 'remove_stage', { stageKey: 'ship' });
  expect(effect.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  await shippedThrough(db, parked);
  expect(await itemState(db, parked.item.itemId)).toMatchObject({ stageKey: 'validate' });
  expect(await decisionRows(db, parked.item)).toBe(1);
  expect((await unshipped(db, parked)).body).toMatchObject({ status: 'accepted' });
  const before = await eventCount(db, harnessId);
  const held = await send(db, IAN, harnessId, 'remove_stage', { stageKey: 'ship' });
  expect(held.body).toMatchObject({ status: 'error', reason: 'stage_not_empty' });
  expect(await eventCount(db, harnessId)).toBe(before);
  expect(await stageKeys(db, harnessId)).toContain('ship');
}

describe.skipIf(!testServer)('WB-1 KN-18 the stage command on the person surface', () => {
  it('WB-1 activate_template creates the harness named in the path from a template, for an admin of the body area', () =>
    withAppDatabase(activates));

  it('activate_template answers a person who cannot administer the area not_permitted alike whether the id, key or repository is taken or free, and harness_exists only to an admin, who reads every area', () =>
    withAppDatabase(hidesWhatItCannotRead));

  it('WB-1 pause and resume through the command API record harness_paused and harness_resumed', () =>
    withAppDatabase(pausesAndResumes));

  it('KN-18 remove_stage through the command API refuses stage_not_empty for a stage holding an item and removes an empty spare stage', () =>
    withAppDatabase(removesOnlyAnEmptyStage));

  it('KN-18 create_stage and reorder_stages through the command API are the stage command', () =>
    withAppDatabase(createsAndReorders));

  it("update_stage lowering Ship's exit to checks and create_stage adding a merge stage without a gate are both refused stage_edit_refused, and update_stage cannot pause", () =>
    withAppDatabase(noEditBypassesShip));

  it('the stage command refuses an agent on every route and records nothing', () =>
    withAppDatabase(agentsRefused));

  it('KN-18 update_stage refuses decision_in_flight while an approval waits for its connector', () =>
    withAppDatabase(connectorHeldWhileApprovalWaits));

  it('the connector guard reads only the open items at the stage, so a done item does not hold the connector', () =>
    withAppDatabase(onlyOpenItemsHoldTheConnector));

  it('KN-18 remove_stage refuses an effect stage, and a stage with gate decision history once it holds no item', () =>
    withAppDatabase(historyHoldsAStage));
});
