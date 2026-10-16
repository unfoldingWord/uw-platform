import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ItemState } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { revokeSeededGrant, seedGrant, seedPage } from '@uw/db/test-seed';
import { platformStore } from '../ports/store.ts';
import { agentOf, kernelOn, personOn } from '../testing/kernel.ts';
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
  type Scene,
} from '../testing/commands.ts';

const AREA = '80-89';

async function createdPage(db: Database, by: Person, type: string, jdArea = AREA) {
  const pageId = randomUUID();
  const title = `The board ${pageId.slice(0, 8)}`;
  const frontmatter =
    type === 'product'
      ? { owner: `human:${by.id}`, summary: 'A board.' }
      : { name: 'write-notes', description: 'Draft notes.' };
  const sent = await post(db, by.email, '/api/pages/commands/create_page', {
    command: 'create_page',
    requestId: randomUUID(),
    pageId,
    type,
    jdArea,
    slug: `board-${pageId.slice(0, 8)}`,
    title,
    parentId: null,
    frontmatter,
    bodyMd: 'The board.\n\n## Done when\n\n- People see the board.',
    status: 'draft',
  });
  expect(sent.body).toMatchObject({ status: 'accepted' });
  return { pageId, title };
}

function send(db: Database, scene: Scene, name: string, body: Record<string, unknown>) {
  return command(db, scene.editor, scene.harnessId, name, { requestId: randomUUID(), ...body });
}

async function claimedByEditor(db: Database, scene: Scene, itemId: string): Promise<void> {
  expect((await send(db, scene, 'claim', { itemId })).body).toMatchObject({ status: 'accepted' });
}

async function moveTo(db: Database, itemId: string, stageKey: string): Promise<void> {
  await platformStore(db).transaction(async (tx) => {
    const item = await tx.harnessItems.read.lock(itemId);
    if (item === null) throw new Error('item vanished');
    const moved: ItemState = { ...item, stageKey };
    await tx.harnessItems.write.project(moved);
  });
}

async function kickstartWrapsThePage(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const { pageId, title } = await createdPage(db, scene.editor, 'product');
  const requestId = randomUUID();
  const sent = await send(db, scene, 'kickstart', { requestId, pageId });
  expect(sent.body).toEqual({ status: 'accepted', requestId });
  const created = await eventsNamed(db, scene.harnessId, 'item_created');
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({
    actor: `human:${scene.editor.id}`,
    requestId,
    traceId: sent.traceId,
    evidence: { pageId, title, stage: 'package' },
  });
}

async function kickstartRefusals(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  await seedGrant(db, {
    id: randomUUID(),
    personId: scene.editor.id,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: '20-29',
    grantedAt: new Date(Date.now() - 60_000),
    expiresAt: null,
  });
  const skill = await createdPage(db, scene.editor, 'skill');
  const elsewhere = await createdPage(db, scene.editor, 'product', '20-29');
  const unread = randomUUID();
  await seedPage(db, {
    id: unread,
    type: 'product',
    status: 'active',
    jdArea: '30-39',
    bodyMd: 'Hidden.',
    slug: `hidden-${unread.slice(0, 8)}`,
    title: 'Hidden',
  });
  const requestId = randomUUID();
  const kickstart = (pageId: string) =>
    command(db, scene.editor, scene.harnessId, 'kickstart', { requestId, pageId });
  const wrongType = await kickstart(skill.pageId);
  expect(wrongType.body).toEqual({ status: 'error', requestId, reason: 'malformed_command' });
  const missing = await kickstart(randomUUID());
  expect(missing.body).toEqual({ status: 'error', requestId, reason: 'page_not_found' });
  expect((await kickstart(elsewhere.pageId)).text).toBe(missing.text);
  expect((await kickstart(unread)).text).toBe(missing.text);
  expect(await eventsNamed(db, scene.harnessId, 'item_created')).toEqual([]);
}

async function holderSubmits(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const itemId = await enqueued(db, scene.harnessId, 'Submit the board');
  await claimedByEditor(db, scene, itemId);
  const submitted = await send(db, scene, 'submit_to_gate', {
    itemId,
    to: null,
    pullRequest: null,
    head: null,
  });
  expect(submitted.body).toMatchObject({ status: 'accepted' });
  expect(await itemState(db, itemId)).toMatchObject({ stageKey: 'scope' });
  const [event] = await eventsNamed(db, scene.harnessId, 'submitted_to_gate');
  expect(event).toMatchObject({ actor: `human:${scene.editor.id}`, requestId: expect.any(String) });
}

async function submitTakesNoFacts(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const itemId = await enqueued(db, scene.harnessId, 'Submit the board');
  await claimedByEditor(db, scene, itemId);
  const before = await eventCount(db, scene.harnessId);
  const body = { itemId, to: null, pullRequest: null, head: null };
  const smuggled = await send(db, scene, 'submit_to_gate', { ...body, paths: ['infra/x.toml'] });
  expect(smuggled.body).toMatchObject({ status: 'error', reason: 'malformed_command' });
  const otherRepo = await send(db, scene, 'submit_to_gate', {
    ...body,
    pullRequest: { repo: 'unfoldingWord/uw-other', number: 7 },
    head: 'a'.repeat(40),
  });
  expect(otherRepo.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  expect(await eventCount(db, scene.harnessId)).toBe(before);
  expect(await itemState(db, itemId)).toMatchObject({ stageKey: 'package' });
}

async function tweakParks(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const itemId = await enqueued(db, scene.harnessId, 'Tweak the board');
  await moveTo(db, itemId, 'validate');
  await claimedByEditor(db, scene, itemId);
  const tweaked = await send(db, scene, 'tweak_package', { itemId });
  expect(tweaked.body).toMatchObject({ status: 'accepted' });
  expect(await itemState(db, itemId)).toMatchObject({
    stageKey: 'validate',
    gateStatus: 'parked',
    gateTarget: 'package',
  });
}

async function tweakForeignItem(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const elsewhere = await enqueued(db, scene.otherHarnessId, 'Not this board');
  await moveTo(db, elsewhere, 'validate');
  const before = await eventCount(db, scene.otherHarnessId);
  const requestId = randomUUID();
  const foreign = await command(db, scene.editor, scene.harnessId, 'tweak_package', {
    requestId,
    itemId: elsewhere,
  });
  expect(foreign.body).toEqual({ status: 'error', requestId, reason: 'item_not_found' });
  expect(await eventCount(db, scene.otherHarnessId)).toBe(before);
}

async function runsAfterCan(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const itemId = await enqueued(db, scene.harnessId, 'Run the board');
  const admin = await ian(db);
  accepted(
    await kernelOn(db, { now: () => new Date() }).items.claim(callerOf(admin), {
      itemId,
      delegationId: null,
    }),
  );
  const before = await eventCount(db, scene.harnessId);
  for (const [name, extra] of [
    ['prompt_run', { message: 'Look again' }],
    ['stop_run', {}],
  ] as const) {
    const requestId = randomUUID();
    const body = { requestId, itemId, ...extra };
    const viewer = await command(db, scene.viewer, scene.harnessId, name, body);
    expect(viewer.body).toEqual({ status: 'error', requestId, reason: 'not_permitted' });
    const editor = await command(db, scene.editor, scene.harnessId, name, body);
    expect(editor.body).toEqual({ status: 'error', requestId, reason: 'run_not_found' });
  }
  expect(await eventCount(db, scene.harnessId)).toBe(before);
}

async function agentsActOnNothing(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const itemId = await enqueued(db, scene.harnessId, 'Pause the board');
  const { pageId } = await createdPage(db, scene.editor, 'product');
  const kernel = kernelOn(db, { now: () => new Date() });
  const admin = await ian(db);
  accepted(await kernel.items.claim(callerOf(admin), { itemId, delegationId: null }));
  accepted(
    await kernel.stages.pause(callerOf(admin), { harnessId: scene.harnessId, stageKey: null }),
  );
  const before = await eventCount(db, scene.harnessId);
  const agent = agentOf(admin, 'builder');
  const scope = dispatchScope(db);
  const attempts = [
    ['kickstart', { pageId }],
    ['enqueue', { title: 'Sneak an item', pageId: null, due: null }],
    ['submit_to_gate', { itemId, to: null, pullRequest: null, head: null }],
    ['prompt_run', { itemId, message: 'Keep going' }],
    ['stop_run', { itemId }],
    ['tweak_package', { itemId }],
    ['reorder', { itemId, beforeItemId: null }],
  ] as const;
  for (const [name, body] of attempts) {
    const requestId = randomUUID();
    const outcome = await dispatchAs(agent, scene.harnessId, name, { requestId, ...body }, scope);
    expect(outcome).toEqual({ status: 'error', requestId, reason: 'not_permitted' });
  }
  expect(await eventCount(db, scene.harnessId)).toBe(before);
  const person = { requestId: randomUUID(), itemId, to: null, pullRequest: null, head: null };
  const submitted = await dispatchAs(admin, scene.harnessId, 'submit_to_gate', person, scope);
  expect(submitted).toEqual({ status: 'accepted', requestId: person.requestId });
}

async function staleGrantsRefused(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const itemId = await enqueued(db, scene.harnessId, 'Revoke the board');
  await moveTo(db, itemId, 'validate');
  await claimedByEditor(db, scene, itemId);
  const { pageId } = await createdPage(db, scene.editor, 'product');
  const stale = await personOn(db, scene.editor.id, scene.editor.email, new Date());
  await revokeSeededGrant(db, scene.editor.grantId, new Date(Date.now() - 1000));
  const before = await eventCount(db, scene.harnessId);
  const scope = dispatchScope(db);
  const attempts = [
    ['kickstart', { pageId }],
    ['submit_to_gate', { itemId, to: null, pullRequest: null, head: null }],
    ['tweak_package', { itemId }],
    ['reorder', { itemId, beforeItemId: null }],
  ] as const;
  for (const [name, body] of attempts) {
    const requestId = randomUUID();
    const outcome = await dispatchAs(stale, scene.harnessId, name, { requestId, ...body }, scope);
    expect(outcome).toEqual({ status: 'error', requestId, reason: 'not_permitted' });
  }
  expect(await eventCount(db, scene.harnessId)).toBe(before);
}

async function kickstartNotReady(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const pageId = randomUUID();
  await seedPage(db, {
    id: pageId,
    type: 'product',
    status: 'active',
    jdArea: AREA,
    bodyMd: 'People see their harness as a board of stages.',
    slug: `board-${pageId.slice(0, 8)}`,
    title: 'Show the board',
  });
  const sent = await send(db, scene, 'kickstart', { pageId });
  expect(sent.body).toMatchObject({ status: 'error', reason: 'done_when_missing' });
  expect(await eventsNamed(db, scene.harnessId, 'item_created')).toEqual([]);
  const [recorded] = await eventsNamed(db, scene.harnessId, 'done_when_missing');
  expect(recorded?.evidence).toEqual({
    via: 'kickstart',
    issue: null,
    pageId,
    title: 'Show the board',
  });
}

describe.skipIf(!testServer)('WB-1 kickstart through the command API', () => {
  it('WB-1 kickstart enqueues one item wrapping the harness’s product page, titled with the page', () =>
    withAppDatabase(kickstartWrapsThePage));

  it('WB-1 kickstart refuses a page of another type as malformed_command, and a page in another area or one the person cannot read as page_not_found', () =>
    withAppDatabase(kickstartRefusals));

  it('EI-2 kickstart refuses a product page with no done-when and records it against the page', () =>
    withAppDatabase(kickstartNotReady));
});

describe.skipIf(!testServer)('WB-1 submit and tweak package through the command API', () => {
  it('WB-1 submit_to_gate by the holding person runs the stage’s gate', () =>
    withAppDatabase(holderSubmits));

  it('WB-1 a submit body carries no paths, and a pull request in another repository is refused', () =>
    withAppDatabase(submitTakesNoFacts));

  it('WB-1 tweak_package parks an item for a person’s decision on the occasional tweak', () =>
    withAppDatabase(tweakParks));

  it('tweak_package naming an item of another harness answers item_not_found', () =>
    withAppDatabase(tweakForeignItem));
});

describe.skipIf(!testServer)('prompt and stop run through the command API', () => {
  it('WB-1 prompt_run and stop_run run can() before the kernel: a viewer gets not_permitted, an editor the kernel’s run_not_found on an item with no live run', () =>
    withAppDatabase(runsAfterCan));
});

describe.skipIf(!testServer)('the item commands keep the kernel’s guards', () => {
  it('an agent is refused every item command before any state, and a person still submits on a paused harness', () =>
    withAppDatabase(agentsActOnNothing));

  it('a grant revoked after the principal was resolved is caught by the re-read in the transaction', () =>
    withAppDatabase(staleGrantsRefused));
});
