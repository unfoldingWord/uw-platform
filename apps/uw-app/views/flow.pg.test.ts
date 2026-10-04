import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedOpenItems } from '@uw/db/test-seed';
import { VIEW_LIMIT, type Clock, type Template } from '@uw/harness';
import {
  activatedHarness,
  boardWorld,
  enqueuedItem,
  ianOn,
  type BoardWorld,
} from '../testing/board-world.ts';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';
import { boardPath, flowPath } from './parts/paths.ts';

const seedClock: Clock = { now: () => new Date('2026-10-02T06:00:00.000Z') };
const viewClock: Clock = { now: () => new Date('2026-10-02T09:00:00.000Z') };
const missing = '00000000-0000-4000-8000-00000000dead';

function flowOf(world: BoardWorld, email = world.ianEmail, path = flowPath(world.harnessId)) {
  return getHtml(world.db, email, path, {}, viewClock);
}

function documentOf(html: string): Document {
  return new JSDOM(html).window.document;
}

async function inFlow(work: (world: BoardWorld) => Promise<void>): Promise<void> {
  await withAppDatabase(async (db: Database) => work(await boardWorld(db, seedClock)));
}

function nodeLabels(document: Document): readonly (string | null)[] {
  return [...document.querySelectorAll('main svg a')].map((link) =>
    link.getAttribute('aria-label'),
  );
}

async function drawnInOrder(world: BoardWorld): Promise<void> {
  const document = documentOf((await flowOf(world)).text);
  const svg = document.querySelector('main svg[role="group"]');
  expect(svg?.querySelector('title')?.textContent).toBe(
    'software as the build, measure, learn loop',
  );
  const bands = [...document.querySelectorAll('main svg [data-bracket]')].map((band) => [
    band.getAttribute('data-bracket'),
    band.querySelector('text')?.textContent,
  ]);
  expect(bands).toEqual([
    ['product_package', 'Product package'],
    ['build_package', 'Build package'],
    ['deploy_package', 'Deploy package'],
    ['iterate', 'Iterate'],
  ]);
  const titles = nodeLabels(document).map((label) => label?.replace(/, \d+ items, .*$/, ''));
  expect(titles).toEqual([
    'Backlog issue',
    'Premise verified',
    'Plan approved',
    'Commits to PR',
    'CI and review verdict',
    'Merge, tag, deploy',
    'Deploy watched',
    'Issue closed and learning',
  ]);
  expect(svg?.querySelector('desc')?.textContent).toContain(
    'Backlog issue, then Premise verified, then Plan approved',
  );
}

async function feedsDrawn(world: BoardWorld): Promise<void> {
  const document = documentOf((await flowOf(world)).text);
  const feeds = [...document.querySelectorAll('main svg [data-feeds]')].map((edge) =>
    edge.getAttribute('data-feeds'),
  );
  expect(feeds).toEqual(['validate package', 'close scope']);
  const steps = document.querySelectorAll('main svg [data-next]');
  expect(steps).toHaveLength(7);
}

function stageRow(document: Document, title: string): readonly string[] {
  const row = [...document.querySelectorAll('main table tbody tr')].find((tr) =>
    (tr.querySelector('td')?.textContent ?? '').startsWith(title),
  );
  return [...(row?.querySelectorAll('td') ?? [])].map((cell) => cell.textContent ?? '');
}

async function stageFacts(world: BoardWorld): Promise<void> {
  const document = documentOf((await flowOf(world)).text);
  expect(document.querySelector('main table caption')?.textContent).toBe('Stages');
  expect(stageRow(document, 'Commits to PR')).toEqual([
    'Commits to PR',
    'Build package',
    '2',
    '2 of 3',
    '3 h 0 min',
    '$1.50',
    '1,200 subscription tokens',
    'Running',
  ]);
  expect(stageRow(document, 'Deploy watched')).toEqual([
    'Deploy watched',
    'Iterate',
    '0',
    '0 of 3',
    'None',
    'No metered cost',
    'No subscription tokens',
    'Running',
  ]);
  expect(nodeLabels(document)).toContain('Commits to PR, 2 items, 2 of 3 in progress');
  expect(stageRow(document, 'Premise verified')[6]).not.toMatch(/\$/);
}

async function kindleOnlyOnShip(world: BoardWorld): Promise<void> {
  const document = documentOf((await flowOf(world)).text);
  const kindled = [...document.querySelectorAll('main [class*="kindle"]')];
  expect(kindled.length).toBeGreaterThan(0);
  for (const element of kindled) {
    const node = element.closest('[data-stage]');
    const mark = element.closest('td');
    const onShip =
      node?.getAttribute('data-stage') === 'ship' ||
      (mark?.textContent ?? '').startsWith('Merge, tag, deploy');
    expect(onShip).toBe(true);
  }
  expect(document.querySelector('main [data-stage="ship"] [class*="kindle"]')).not.toBeNull();
  expect(stageRow(document, 'Merge, tag, deploy')[0]).toBe('Merge, tag, deployPerson decides');
}

async function pausedShows(world: BoardWorld): Promise<void> {
  const document = documentOf((await flowOf(world)).text);
  const node = document.querySelector('main svg [data-stage="check"]');
  expect(node?.textContent).toContain('Paused');
  expect(node?.querySelector('rect')?.getAttribute('stroke-dasharray')).toBeNull();
  expect(stageRow(document, 'CI and review verdict').at(-1)).toBe('Paused');
}

async function linksToBoard(world: BoardWorld): Promise<void> {
  const document = documentOf((await flowOf(world)).text);
  const hrefs = [...document.querySelectorAll('main svg a')].map((link) =>
    link.getAttribute('href'),
  );
  expect(hrefs[3]).toBe(boardPath(world.harnessId, 'build'));
  const tableLink = document.querySelector('main table tbody tr a');
  expect(tableLink?.getAttribute('href')).toBe(boardPath(world.harnessId, 'package'));
}

async function liveOnHarness(world: BoardWorld): Promise<void> {
  const page = await flowOf(world);
  const marker = documentOf(page.text).querySelector('main [data-live]');
  expect(marker?.getAttribute('data-live-harness')).toBe(world.harnessId);
  expect(Number(marker?.getAttribute('data-cursor'))).toBeGreaterThan(10);
  const fragment = await getHtml(
    world.db,
    world.ianEmail,
    flowPath(world.harnessId),
    { 'x-uw-fragment': 'main' },
    viewClock,
  );
  expect(fragment.text).not.toMatch(/<html|<nav/i);
  expect(fragment.text).toContain('Commits to PR');
}

async function hiddenIsMissing(world: BoardWorld): Promise<void> {
  const hidden = await flowOf(world, world.stranger.email);
  const absent = await flowOf(world, world.stranger.email, flowPath(missing));
  const malformed = await flowOf(world, world.stranger.email, flowPath('not-an-id'));
  expect([hidden.status, absent.status, malformed.status]).toEqual([404, 404, 404]);
  expect(hidden.text).toBe(absent.text);
  expect(malformed.text).toBe(absent.text);
  expect(hidden.text).toContain('We could not find that page');
}

const loop: Template = {
  key: 'field-notes',
  title: 'Field notes',
  stages: [
    {
      key: 'gather',
      title: 'Gather notes',
      position: 5,
      bracket: 'iterate',
      agentPickup: 'allowed',
      exitGate: 'checks',
      connector: 'none',
      wipLimit: 2,
      validators: [],
      feeds: [],
    },
    {
      key: 'listen',
      title: 'Listen first',
      position: 1,
      bracket: 'build_package',
      agentPickup: 'none',
      exitGate: 'human_approval',
      connector: 'none',
      wipLimit: 4,
      validators: [],
      feeds: ['gather'],
    },
  ],
};

async function foreignTemplate(world: BoardWorld): Promise<void> {
  const ian = await ianOn(world.db, seedClock.now());
  const kernel = kernelOn(world.db, seedClock);
  const harnessId = await activatedHarness(kernel, ian, loop, 'field-notes');
  await enqueuedItem(kernel, ian, harnessId, 'Hear the story');
  const document = documentOf((await flowOf(world, world.ianEmail, flowPath(harnessId))).text);
  expect(nodeLabels(document)).toEqual([
    'Listen first, 1 items, 0 of 4 in progress',
    'Gather notes, 0 items, 0 of 2 in progress',
  ]);
  const feeds = [...document.querySelectorAll('main svg [data-feeds]')].map((edge) =>
    edge.getAttribute('data-feeds'),
  );
  expect(feeds).toEqual(['listen gather']);
  expect(document.querySelector('main [data-stage="listen"] [class*="kindle"]')).not.toBeNull();
}

async function cappedSaysAtLeast(world: BoardWorld): Promise<void> {
  const before = documentOf((await flowOf(world)).text);
  expect(before.querySelector('main [role="note"]')).toBeNull();
  await seedOpenItems(world.db, {
    harnessId: world.harnessId,
    stageKey: 'build',
    count: VIEW_LIMIT,
  });
  const after = documentOf((await flowOf(world)).text);
  expect(after.querySelector('main [role="note"]')?.textContent).toBe(
    'This harness has at least 5,000 open items. The counts and costs cover the 5,000 with the highest priority.',
  );
}

async function scrollsAtPhoneWidth(world: BoardWorld): Promise<void> {
  const document = documentOf((await flowOf(world)).text);
  const svg = document.querySelector('main svg[role="group"]');
  const classes = (svg?.getAttribute('class') ?? '').split(' ');
  expect(classes).toContain('min-w-[var(--uw-flow-diagram)]');
  expect(classes).not.toContain('min-w-0');
  expect(svg?.parentElement?.getAttribute('class')).toContain('overflow-x-auto');
  const layout = readFileSync('packages/ui/tokens/layout.css', 'utf8');
  expect(layout).toMatch(/--uw-flow-diagram: \d+rem;/);
}

async function noProblems(world: BoardWorld): Promise<void> {
  expect(await screenProblems((await flowOf(world)).text)).toEqual([]);
  expect(await screenProblems((await flowOf(world, world.viewer.email)).text)).toEqual([]);
}

describe.skipIf(!testServer)('the Flow view', () => {
  it('WB-4 the flow view draws every stage from its rows under the four brackets, in position order', () =>
    inFlow(drawnInOrder));
  it('WB-4 the two feeds edges are drawn from the stage rows', () => inFlow(feedsDrawn));
  it('WB-4 each stage shows its item count, its WIP against its limit, its oldest item age and its cost, metered and subscription apart', () =>
    inFlow(stageFacts));
  it('WB-4 only the human-gate stage carries Kindle', () => inFlow(kindleOnlyOnShip));
  it('WB-4 a paused lane shows as paused', () => inFlow(pausedShows));
  it('WB-4 each stage links to the board filtered to it', () => inFlow(linksToBoard));
  it('WB-4 the flow view is live on its harness', () => inFlow(liveOnHarness));
  it('a harness the person cannot read renders the same not-found page as a missing one', () =>
    inFlow(hiddenIsMissing));
  it('WB-4 a harness with stage keys and brackets of neither template is drawn from its rows', () =>
    inFlow(foreignTemplate));
  it('the flow view says at least when the harness has more open items than it reads', () =>
    inFlow(cappedSaysAtLeast));
  it('the flow diagram keeps a minimum width from a size token and scrolls inside its own wrapper', () =>
    inFlow(scrollsAtPhoneWidth));
  it('the flow view renders with no screen problems', () => inFlow(noProblems));
});
