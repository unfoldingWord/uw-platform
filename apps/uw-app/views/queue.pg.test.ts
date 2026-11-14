import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import type { Clock } from '@uw/harness';
import { commandBody } from '../islands/browser/command-body.ts';
import {
  advanced,
  boardWorld,
  enqueuedItem,
  heldByAgent,
  type BoardWorld,
} from '../testing/board-world.ts';
import { accepted, callerOf, post } from '../testing/commands.ts';
import { agentOf, kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml, pageContent } from '../testing/views.ts';
import { queuePath, itemPath } from './parts/paths.ts';

const seedClock: Clock = { now: () => new Date('2026-10-02T06:00:00.000Z') };
const viewClock: Clock = { now: () => new Date('2026-10-02T09:00:00.000Z') };
const realClock: Clock = { now: () => new Date() };
const HOUR = 3_600_000;

type Fields = Readonly<Record<string, string>>;

function boardOf(world: BoardWorld, email = world.ianEmail, path = queuePath(world.harnessId)) {
  return getHtml(world.db, email, path, {}, viewClock);
}

async function documentOf(
  world: BoardWorld,
  email = world.ianEmail,
  path = queuePath(world.harnessId),
): Promise<Document> {
  return new JSDOM((await boardOf(world, email, path)).text).window.document;
}

async function inBoard(work: (world: BoardWorld) => Promise<void>): Promise<void> {
  await withAppDatabase(async (db: Database) => work(await boardWorld(db, seedClock)));
}

function factsOf(scope: Element | undefined): readonly (readonly [string, string])[] {
  return [...(scope?.querySelectorAll(':scope > dl > dt') ?? [])].map(
    (term) => [term.textContent ?? '', term.nextElementSibling?.textContent ?? ''] as const,
  );
}

function laneOf(document: Document, title: string): Element | undefined {
  return [...document.querySelectorAll('main section[aria-labelledby]')].find(
    (lane) => lane.querySelector('h2')?.textContent === title,
  );
}

function cardOf(document: Document, title: string): Element | undefined {
  return [...document.querySelectorAll('main article')].find(
    (card) => card.querySelector('h3')?.textContent === title,
  );
}

function metaOf(card: Element | undefined): Readonly<Record<string, string>> {
  const terms = [...(card?.querySelectorAll('dl dt') ?? [])];
  return Object.fromEntries(
    terms.map((term) => [term.textContent ?? '', term.nextElementSibling?.textContent ?? '']),
  );
}

async function columns(world: BoardWorld): Promise<void> {
  const document = await documentOf(world);
  const lanes = [...document.querySelectorAll('main section[aria-labelledby]')];
  expect(lanes.map((lane) => lane.querySelector('h2')?.textContent)).toHaveLength(8);
  const build = laneOf(document, 'Commits to PR');
  expect(build?.textContent).toContain('2 of 3');
  expect(factsOf(build)).toEqual([
    ['Items', '2'],
    ['Agent pickup', 'Agents may pick up'],
    ['To leave', 'Checks pass'],
  ]);
  expect(factsOf(laneOf(document, 'Merge, tag, deploy'))).toEqual([
    ['Items', '0'],
    ['Agent pickup', 'No agents'],
    ['To leave', 'A person approves'],
  ]);
  expect(laneOf(document, 'CI and review verdict')?.textContent).toContain('Paused');
  const phases = [...document.querySelectorAll('main [role="group"][data-phase]')];
  expect(phases.map((phase) => phase.getAttribute('aria-label'))).toEqual([
    'Product package',
    'Build package',
    'Deploy package',
    'Iterate',
  ]);
  expect(phases.flatMap((phase) => [...phase.querySelectorAll('section h2')]).length).toBe(8);
}

async function cardFacts(world: BoardWorld): Promise<void> {
  const document = await documentOf(world);
  const card = cardOf(document, 'Wire the run host');
  expect(card?.querySelector('h3 a')?.getAttribute('href')).toBe(
    itemPath(world.harnessId, world.metered),
  );
  expect(metaOf(card)).toEqual({
    Issue: 'None',
    'Pull request': 'None',
    Holder: 'Claimed by agent:builder, for 3 h 0 min',
    Host: 'Platform',
    Lease: 'Until 2026-10-02 10:00 UTC',
    Risk: 'Not derived',
    'Cost basis': 'Metered',
    'Metered cost': '$1.50',
    'Subscription tokens': 'No subscription tokens',
  });
  expect(card?.querySelector('[data-status]')?.textContent).toBe('Working · Priority 2');
  expect(metaOf(cardOf(document, 'Write the run notes'))['Host']).toBe('Own machine');
  expect(metaOf(cardOf(document, 'Draw the icon'))).toMatchObject({
    Holder: 'Nobody',
    Host: 'Nobody',
    'Cost basis': 'No runs yet',
  });
}

async function leaseForAgentOnly(world: BoardWorld): Promise<void> {
  const document = await documentOf(world);
  expect(metaOf(cardOf(document, 'Write the run notes'))['Lease']).toBe(
    'Until 2026-10-02 10:00 UTC',
  );
  const person = metaOf(cardOf(document, 'Review the copy'));
  expect(person['Holder']).toBe(`Claimed by ${world.ian.identity}, for 3 h 0 min`);
  expect(person['Host']).toBe('Person');
  expect(person['Lease']).toBeUndefined();
}

async function subscriptionTokensOnly(world: BoardWorld): Promise<void> {
  const document = await documentOf(world);
  const card = cardOf(document, 'Write the run notes');
  expect(metaOf(card)).toMatchObject({
    'Cost basis': 'Subscription',
    'Metered cost': 'No metered cost',
    'Subscription tokens': '1,200 subscription tokens',
  });
  expect(card?.textContent).not.toMatch(/\$/);
}

function formOf(scope: Element | undefined, command: string): Element | null {
  return scope?.querySelector(`form[data-command="${command}"]`) ?? null;
}

function fieldsOf(form: Element | null): Fields {
  const controls = [...(form?.querySelectorAll('input[name], select[name], textarea[name]') ?? [])];
  return Object.fromEntries(
    controls.map((control) => [
      control.getAttribute('name') ?? '',
      (control as HTMLInputElement).value,
    ]),
  );
}

async function commandForms(world: BoardWorld): Promise<void> {
  const document = await documentOf(world);
  const claim = formOf(cardOf(document, 'Draw the icon'), 'claim');
  expect(claim?.getAttribute('data-harness')).toBe(world.harnessId);
  expect(fieldsOf(claim)).toEqual({ itemId: world.unheld });
  const viewerQueue = await documentOf(world, world.viewer.email);
  expect(formOf(cardOf(viewerQueue, 'Draw the icon'), 'claim')).toBeNull();
  expect(fieldsOf(formOf(cardOf(document, 'Review the copy'), 'release'))).toEqual({
    itemId: world.personHeld,
  });
  const reorder = formOf(cardOf(document, 'Wire the run host'), 'reorder');
  const options = [...(reorder?.querySelectorAll('option') ?? [])].map((option) => [
    option.getAttribute('value'),
    option.textContent,
  ]);
  expect(options).toEqual([
    [world.subscribed, 'Write the run notes'],
    ['', 'The end of the column'],
  ]);
  expect(reorder?.querySelector('label')?.textContent).toBe('Move before');
  expect(reorder?.querySelector('button')?.textContent).toBe('Move');
  await enqueueAndRelease(world, document);
}

async function enqueueAndRelease(world: BoardWorld, document: Document): Promise<void> {
  const enqueue = formOf(laneOf(document, 'Backlog issue'), 'enqueue');
  expect(enqueue?.querySelector('input[name="title"]')?.getAttribute('maxlength')).toBe('200');
  expect(enqueue?.querySelector('button')?.textContent).toBe('Add item');
  expect(document.querySelectorAll('form[data-command="enqueue"]')).toHaveLength(1);
  const viewerBoard = await documentOf(world, world.viewer.email);
  expect(formOf(cardOf(viewerBoard, 'Write the run notes'), 'release')).toBeNull();
  expect(formOf(cardOf(document, 'Write the run notes'), 'release')).not.toBeNull();
}

async function claimFrom(world: BoardWorld, email: string, title: string) {
  const html = await getHtml(world.db, world.ianEmail, queuePath(world.harnessId), {}, realClock);
  const document = new JSDOM(html.text).window.document;
  const body = commandBody(
    'claim',
    fieldsOf(formOf(cardOf(document, title), 'claim')),
    randomUUID(),
  );
  return async () => {
    const sent = await post(
      world.db,
      email,
      `/api/harness/${world.harnessId}/commands/claim`,
      body,
    );
    return sent.body['reason'];
  };
}

async function fullBuild(world: BoardWorld): Promise<void> {
  const kernel = kernelOn(world.db, realClock);
  const held = await enqueuedItem(kernel, world.ian, world.harnessId, 'Fill the column');
  const waiting = await enqueuedItem(kernel, world.ian, world.harnessId, 'Wait for room');
  for (const itemId of [held, waiting]) await advanced(kernel, world.ian, itemId, 3);
  accepted(await kernel.items.claim(callerOf(world.ian), { itemId: held, delegationId: null }));
}

async function claimsRefused(db: Database): Promise<void> {
  const world = await boardWorld(db, realClock);
  const viewer = await claimFrom(world, world.viewer.email, 'Draw the icon');
  expect(await viewer()).toBe('not_permitted');
  const raced = await claimFrom(world, world.ianEmail, 'Draw the icon');
  await heldByAgent(db, world.unheld, 'agent:scout', new Date(Date.now() + HOUR));
  expect(await raced()).toBe('lease_held');
  await fullBuild(world);
  const wip = await claimFrom(world, world.ianEmail, 'Wait for room');
  expect(await wip()).toBe('wip_limit_reached');
}

async function oneStage(world: BoardWorld): Promise<void> {
  const document = await documentOf(world, world.ianEmail, queuePath(world.harnessId, 'build'));
  const lanes = [...document.querySelectorAll('main section[aria-labelledby] h2')].map(
    (h) => h.textContent,
  );
  expect(lanes).toEqual(['Commits to PR']);
  const current = document.querySelector('main nav[aria-label="Stages"] [aria-current="true"]');
  expect(current?.textContent).toBe('Commits to PR');
  const unknown = await boardOf(world, world.ianEmail, queuePath(world.harnessId, 'nowhere'));
  const unpaged = await boardOf(world, world.ianEmail, `${queuePath(world.harnessId)}?after=1.x`);
  expect([unknown.status, unpaged.status]).toEqual([404, 404]);
}

async function hiddenIsMissing(world: BoardWorld): Promise<void> {
  const missing = queuePath('00000000-0000-4000-8000-00000000dead');
  const hidden = await boardOf(world, world.stranger.email);
  const absent = await boardOf(world, world.stranger.email, missing);
  expect([hidden.status, absent.status]).toEqual([404, 404]);
  expect(pageContent(hidden)).toBe(pageContent(absent));
}

async function noProblems(world: BoardWorld): Promise<void> {
  expect(await screenProblems((await boardOf(world)).text)).toEqual([]);
  expect(await screenProblems((await boardOf(world, world.viewer.email)).text)).toEqual([]);
}

async function lookOfBoard(world: BoardWorld): Promise<void> {
  const document = await documentOf(world);
  expect(document.querySelector('main section[aria-label="Pipeline"]')).toBeNull();
  expect(document.querySelectorAll('main section[aria-labelledby^="lane"]')).toHaveLength(8);
  const gate = document.querySelector('main section [aria-label="A person approves"]');
  expect(gate).not.toBeNull();
  expect(document.querySelector('main section [aria-label="A person decides"]')).toBeNull();
  const head = document.querySelector('main [aria-label="Figures"]');
  const figures = [...(head?.querySelectorAll('dt') ?? [])].map((term) => term.textContent?.trim());
  expect(figures).toEqual(['Agents working', 'Waiting on you', 'Spent on these items']);
  const toolbar = document.querySelector('main a[href="/gates"]');
  expect(toolbar?.textContent).toContain('Waiting on you');
  expect(document.querySelector('main section[data-folded="true"]')).not.toBeNull();
  const card = document.querySelector('main article');
  const summaries = [...(card?.querySelectorAll('details summary') ?? [])].map(
    (s) => s.textContent,
  );
  expect(summaries).toEqual(expect.arrayContaining(['Move', 'Details']));
}

async function refusalOnCard(world: BoardWorld): Promise<void> {
  const kernel = kernelOn(world.db, viewClock);
  const builder = agentOf(world.ian, 'builder');
  const outcome = await kernel.gates.decide(callerOf(builder), {
    itemId: world.metered,
    decision: 'approve',
    reason: null,
    findings: [],
  });
  expect(outcome.status).toBe('error');
  const document = await documentOf(world);
  const line = cardOf(document, 'Wire the run host')?.querySelector('[data-refusal]');
  expect(line?.textContent).toBe(
    `${builder.identity} tried to approve this item, and the platform refused. A person decides.`,
  );
  expect(cardOf(document, 'Draw the icon')?.querySelector('[data-refusal]')).toBeNull();
}

async function oldAddressMoves(world: BoardWorld): Promise<void> {
  const old = await boardOf(world, world.ianEmail, `/harnesses/${world.harnessId}/board`);
  expect(old.status).toBe(301);
  expect(old.headers.get('location')).toBe(queuePath(world.harnessId));
  const hidden = await boardOf(world, world.stranger.email, `/harnesses/${world.harnessId}/board`);
  expect(hidden.status).toBe(404);
}

describe.skipIf(!testServer)('the Queue', () => {
  it('#105 an agent refused on an item shows the refusal on its card', () =>
    inBoard(refusalOnCard));
  it('#105 the old Board address moves to the Queue', () => inBoard(oldAddressMoves));
  it('UI-6 the Board has the figures in its head, the toolbar, a lane per stage with the gate marked, and compact cards', () =>
    inBoard(lookOfBoard));
  it('WB-5 the board has one column per stage with its WIP against its limit, agent pickup and exit gate', () =>
    inBoard(columns));
  it('WB-5 a card shows title, issue ref, holder identity, host, risk tier and domains and cost basis', () =>
    inBoard(cardFacts));
  it('WB-5 a card shows a lease expiry for an agent and none for a person', () =>
    inBoard(leaseForAgentOnly));
  it('WB-5 a subscription card shows tokens and no dollar figure', () =>
    inBoard(subscriptionTokensOnly));
  it('WB-5 claim, release, reorder and enqueue are command forms with their item and harness', () =>
    inBoard(commandForms));
  it('WB-5 a claim refused for the WIP limit, a held lease or a missing grant answers its closed reason', () =>
    withAppDatabase(claimsRefused));
  it('WB-5 the board filtered to one stage shows that column only', () => inBoard(oneStage));
  it('a harness the person cannot read renders the same not-found board as a missing one', () =>
    inBoard(hiddenIsMissing));
  it('the board renders with no screen problems', () => inBoard(noProblems));
});
