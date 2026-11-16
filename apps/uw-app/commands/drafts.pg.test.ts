import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DraftStage } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import {
  gateDeps,
  kimEmail,
  parkedAtShip,
  readyToShip,
  shipWrites,
  type ParkedAtShip,
} from '../github/testing/gate-rig.ts';
import { decisionRows } from '../github/testing/ship-rig.ts';
import { platformStore } from '../ports/store.ts';
import { agentOf, kernelOn } from '../testing/kernel.ts';
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
  itemState,
  post,
  rowan,
  softwareHarness,
  type Person,
} from '../testing/commands.ts';

const ROWAN = { email: 'rowan.test@unfoldingword.org' };

type Who = Pick<Person, 'email'>;
type Edit = (stages: readonly DraftStage[]) => readonly DraftStage[];
type Problem = readonly [string | null, string];

function send(db: Database, who: Who, harnessId: string, name: string, body: object) {
  return command(db, who, harnessId, name, { requestId: randomUUID(), ...body });
}

function spare(change: Partial<DraftStage> = {}): DraftStage {
  return {
    id: null,
    key: 'spare',
    title: 'Spare',
    bracket: 'iterate',
    agentPickup: 'allowed',
    exitGate: 'checks',
    connector: 'none',
    wipLimit: 3,
    instructionsPageId: null,
    validators: [],
    feeds: [],
    ...change,
  };
}

async function draftOf(db: Database, harnessId: string) {
  const kernel = kernelOn(db, { now: () => new Date() });
  const view = accepted(await kernel.views.workflowDraft(callerOf(await rowan(db)), { harnessId }));
  if (view === null) throw new Error('expected an open draft');
  return view;
}

async function stageKeys(db: Database, harnessId: string): Promise<string[]> {
  const stages = await platformStore(db).transaction((tx) =>
    tx.harnessStages.read.forHarness(harnessId),
  );
  return stages.map((stage) => stage.key);
}

async function published(db: Database, harnessId: string, edit: Edit) {
  expect((await send(db, ROWAN, harnessId, 'open_workflow_draft', {})).body).toMatchObject({
    status: 'accepted',
  });
  const opened = await draftOf(db, harnessId);
  const saved = await send(db, ROWAN, harnessId, 'save_workflow_draft', {
    revision: opened.revision,
    stages: edit(opened.stages),
  });
  expect(saved.body).toMatchObject({ status: 'accepted' });
  const draft = await draftOf(db, harnessId);
  const requestId = randomUUID();
  const sent = await command(db, ROWAN, harnessId, 'publish_workflow_draft', {
    requestId,
    revision: draft.revision,
  });
  const problems: Problem[] = draft.problems.map((entry) => [entry.stage, entry.code]);
  if (sent.body.status !== 'accepted')
    await send(db, ROWAN, harnessId, 'discard_workflow_draft', {});
  return { sent, requestId, problems };
}

const without =
  (key: string): Edit =>
  (stages) =>
    stages.filter((stage) => stage.key !== key);
const changed =
  (key: string, change: Partial<DraftStage>): Edit =>
  (stages) =>
    stages.map((stage) => (stage.key === key ? { ...stage, ...change } : stage));

async function removesOnlyAnEmptyStage(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const { harnessId } = scene;
  const keys = await stageKeys(db, harnessId);
  await enqueued(db, harnessId, 'Hold the package stage');
  const holding = await published(db, harnessId, without('package'));
  expect(holding.sent.body).toMatchObject({ status: 'error', reason: 'draft_has_problems' });
  expect(holding.problems).toEqual([
    ['validate', 'unknown_loop_target'],
    ['package', 'stage_holds_items'],
  ]);
  const effect = await published(db, harnessId, without('ship'));
  expect(effect.problems).toEqual([['ship', 'effect_stage_removed']]);
  expect(await stageKeys(db, harnessId)).toEqual(keys);
  const added = await published(db, harnessId, (stages) => [...stages, spare()]);
  expect(added.sent.body).toMatchObject({ status: 'accepted' });
  const editor = await send(db, scene.editor, harnessId, 'open_workflow_draft', {});
  expect(editor.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const removed = await published(db, harnessId, without('spare'));
  expect(removed.sent.body).toEqual({ status: 'accepted', requestId: removed.requestId });
  const [event] = await eventsNamed(db, harnessId, 'stage_removed');
  expect(event).toMatchObject({ requestId: removed.requestId, evidence: { key: 'spare' } });
  expect(await stageKeys(db, harnessId)).toEqual(keys);
}

async function addsAndReorders(db: Database): Promise<void> {
  const { harnessId } = await softwareHarness(db);
  const keys = await stageKeys(db, harnessId);
  const added = await published(db, harnessId, (stages) => [spare(), ...stages]);
  expect(added.sent.body).toEqual({ status: 'accepted', requestId: added.requestId });
  const [edited] = await eventsNamed(db, harnessId, 'stage_edited');
  expect(edited).toMatchObject({
    requestId: added.requestId,
    evidence: { key: 'spare', before: null },
  });
  const [summary] = await eventsNamed(db, harnessId, 'workflow_published');
  expect(summary?.evidence).toEqual({
    added: ['spare'],
    removed: [],
    changed: [],
    reordered: false,
  });
  expect(await stageKeys(db, harnessId)).toEqual(['spare', ...keys]);
}

async function noDraftBypassesShip(db: Database): Promise<void> {
  const { harnessId } = await softwareHarness(db);
  const keys = await stageKeys(db, harnessId);
  const lowered = await published(db, harnessId, changed('ship', { exitGate: 'checks' }));
  expect(lowered.problems).toEqual([['ship', 'connector_needs_person']]);
  const unguarded = await published(db, harnessId, (stages) => [
    ...stages,
    spare({ connector: 'merge' }),
  ]);
  expect(unguarded.problems).toEqual([['spare', 'connector_needs_person']]);
  for (const attempt of [lowered, unguarded])
    expect(attempt.sent.body).toMatchObject({ status: 'error', reason: 'draft_has_problems' });
  expect(await stageKeys(db, harnessId)).toEqual(keys);
  await send(db, ROWAN, harnessId, 'open_workflow_draft', {});
  const draft = await draftOf(db, harnessId);
  const paused = await send(db, ROWAN, harnessId, 'save_workflow_draft', {
    revision: draft.revision,
    stages: draft.stages.map((stage) => ({ ...stage, paused: true })),
  });
  expect(paused.body).toMatchObject({ status: 'error', reason: 'malformed_command' });
}

function agentAttempts(): ReadonlyArray<readonly [string, object]> {
  return [
    ['open_workflow_draft', {}],
    ['save_workflow_draft', { revision: 1, stages: [spare()] }],
    ['take_over_workflow_draft', { reason: 'mine now' }],
    ['discard_workflow_draft', {}],
    ['publish_workflow_draft', { revision: 1 }],
  ];
}

async function agentsRefused(db: Database): Promise<void> {
  const { harnessId } = await softwareHarness(db);
  const agent = agentOf(await rowan(db), 'builder');
  const scope = dispatchScope(db);
  const before = await eventCount(db, harnessId);
  for (const [name, body] of agentAttempts()) {
    const requestId = randomUUID();
    const outcome = await dispatchAs(agent, harnessId, name, { requestId, ...body }, scope);
    expect(outcome).toEqual({ status: 'error', requestId, reason: 'not_permitted' });
  }
  expect(await eventCount(db, harnessId)).toBe(before);
}

async function lostExit(db: Database, parked: ParkedAtShip): Promise<void> {
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
}

const unshipped = changed('ship', { connector: 'none' });

async function connectorHeldWhileApprovalWaits(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const { harnessId } = parked.item;
  await lostExit(db, parked);
  const held = await published(db, harnessId, unshipped);
  expect(held.problems).toEqual([['ship', 'decision_in_flight']]);
  expect(held.sent.body).toMatchObject({ status: 'error', reason: 'draft_has_problems' });
  const renamed = await published(db, harnessId, changed('ship', { title: 'Ship it' }));
  expect(renamed.sent.body).toMatchObject({ status: 'accepted' });
}

async function onlyOpenItemsHoldTheConnector(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  await lostExit(db, parked);
  await platformStore(db).transaction(async (tx) => {
    const row = await tx.harnessItems.read.lock(parked.item.itemId);
    if (row === null) throw new Error('the parked item vanished');
    await tx.harnessItems.write.project({ ...row, gateStatus: 'done' });
  });
  const sent = await published(db, parked.item.harnessId, unshipped);
  expect(sent.sent.body).toMatchObject({ status: 'accepted' });
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
  const effect = await published(db, harnessId, without('ship'));
  expect(effect.problems).toEqual([['ship', 'effect_stage_removed']]);
  await shippedThrough(db, parked);
  expect(await itemState(db, parked.item.itemId)).toMatchObject({ stageKey: 'validate' });
  expect(await decisionRows(db, parked.item)).toBe(1);
  expect((await published(db, harnessId, unshipped)).sent.body).toMatchObject({
    status: 'accepted',
  });
  const held = await published(db, harnessId, without('ship'));
  expect(held.problems).toEqual([['ship', 'stage_has_history']]);
  expect(await stageKeys(db, harnessId)).toContain('ship');
}

describe.skipIf(!testServer)('#103 KN-18 a workflow changes only through a published draft', () => {
  it('KN-18 a draft that removes a stage holding an item, or an effect stage, cannot publish; an empty spare stage can be added and removed', () =>
    withAppDatabase(removesOnlyAnEmptyStage));

  it('a published draft adds and orders stages and records the change with the publish request', () =>
    withAppDatabase(addsAndReorders));

  it("a draft lowering Ship's exit or adding an ungated merge stage cannot publish, and a draft stage cannot carry paused", () =>
    withAppDatabase(noDraftBypassesShip));

  it('every draft command refuses an agent and records nothing', () =>
    withAppDatabase(agentsRefused));

  it('KN-18 a draft cannot change a connector while an approval waits for it, but can rename the stage', () =>
    withAppDatabase(connectorHeldWhileApprovalWaits));

  it('the connector guard reads only the open items at the stage, so a done item does not hold the connector', () =>
    withAppDatabase(onlyOpenItemsHoldTheConnector));

  it('KN-18 a draft cannot remove an effect stage, nor a stage with gate decision history', () =>
    withAppDatabase(historyHoldsAStage));
});
