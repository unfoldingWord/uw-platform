import { readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { rewriteItem, seedPage } from '@uw/db/test-seed';
import { clock } from '../github/testing/ship-rig.ts';
import { advanced, enqueuedItem, meteredRun, subscriptionRun } from '../testing/board-world.ts';
import { accepted, callerOf } from '../testing/commands.ts';
import { gateWorld, type GateWorld } from '../testing/gate-world.ts';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml, type Html } from '../testing/views.ts';
import { screens, type ScreenEntry } from './registry.ts';

const HOUR = 3_600_000;
const earlier = { now: () => new Date(clock.now().getTime() - 2 * HOUR) };

type Rendered = { readonly name: string; readonly email: string; readonly page: Html };

async function seededWorld(db: Database): Promise<GateWorld> {
  const world = await gateWorld(db);
  const { harnessId } = world.item;
  const kernel = kernelOn(db, earlier);
  await enqueuedItem(kernel, world.ian, harnessId, 'Draw the icon');
  const built = await enqueuedItem(kernel, world.ian, harnessId, 'Wire the run host');
  await advanced(kernel, world.ian, built, 3);
  const at = earlier.now();
  await meteredRun(db, { harnessId, itemId: built, at }, 'completed');
  await subscriptionRun(
    db,
    { harnessId, itemId: built, at },
    `agent:${world.kim.personId ?? ''}/laptop`,
  );
  const lapsing = new Date(at.getTime() + HOUR);
  accepted(
    await kernel.delegations.grant(callerOf(world.kim), {
      harnessId,
      persona: 'agent:scout',
      capability: 'build',
      expiresAt: lapsing,
      supersedes: null,
    }),
  );
  await rewriteItem(db, world.item.itemId, { riskTier: 'high', riskDomains: ['acl'] });
  await seedPage(db, {
    id: '00000000-0000-4000-8000-00000000c0de',
    type: 'learning',
    status: 'active',
    jdArea: '80-89',
    title: 'Boards load slowly',
    bodyMd: '- [assumed] boards load slowly',
    frontmatter: { confidence: 'assumed', as_of: '2026-01-01', supersedes: [], review_by: null },
    slug: 'screens-stale-learning',
  });
  return world;
}

function pathOf(entry: ScreenEntry, world: GateWorld): string {
  return entry.path
    .replace(':harnessId', world.item.harnessId)
    .replace(':itemId', world.item.itemId)
    .replace(':indicator', 'spend');
}

async function renderAll(world: GateWorld): Promise<readonly Rendered[]> {
  const rendered: Rendered[] = [];
  for (const email of [world.kimEmail, world.viewerEmail]) {
    for (const entry of screens) {
      const page = await getHtml(world.db, email, pathOf(entry, world), {}, clock);
      rendered.push({ name: entry.name, email, page });
    }
  }
  return rendered;
}

async function inScreens(work: (rendered: readonly Rendered[]) => Promise<void>): Promise<void> {
  await withAppDatabase(async (db) => work(await renderAll(await seededWorld(db))));
}

function documentOf(page: Html): Document {
  return new JSDOM(page.text).window.document;
}

async function inTheShell(rendered: readonly Rendered[]): Promise<void> {
  for (const { name, email, page } of rendered) {
    const label = `${name} as ${email}`;
    expect(page.status, label).toBe(name === 'not-found' ? 404 : 200);
    const document = documentOf(page);
    expect(document.querySelector('main#main'), label).not.toBeNull();
    expect(document.querySelector('nav[aria-label]'), label).not.toBeNull();
    expect(await screenProblems(page.text), label).toEqual([]);
  }
}

const arbitraryColour = /\[(?:#|rgb|hsl|oklch|color)/;

async function bothSchemes(rendered: readonly Rendered[]): Promise<void> {
  for (const { name, email, page } of rendered) {
    const label = `${name} as ${email}`;
    const document = documentOf(page);
    const scheme = document.querySelector('meta[name="color-scheme"]');
    expect(scheme?.getAttribute('content'), label).toBe('light dark');
    const scripts = [...document.head.querySelectorAll('script:not([src])')];
    expect(
      scripts.some((script) => (script.textContent ?? '').includes('uw-theme')),
      label,
    ).toBe(true);
    const styled = [...document.querySelectorAll('[style]')];
    expect(styled, label).toHaveLength(0);
    const classes = [...document.querySelectorAll('[class]')].map((el) => el.getAttribute('class'));
    expect(
      classes.filter((value) => arbitraryColour.test(value ?? '')),
      label,
    ).toEqual([]);
  }
}

const fixedWidth = [/\b(?:min-|max-)?w-\[\d/, /\bw-\d{3,}/];

async function phoneWidth(rendered: readonly Rendered[]): Promise<void> {
  for (const { name, email, page } of rendered) {
    const label = `${name} as ${email}`;
    const document = documentOf(page);
    const classes = [...document.querySelectorAll('[class]')].map(
      (el) => el.getAttribute('class') ?? '',
    );
    expect(
      classes.filter((value) => fixedWidth.some((width) => width.test(value))),
      label,
    ).toEqual([]);
    for (const wide of document.querySelectorAll('main table, main svg[role]')) {
      expect(wide.closest('.overflow-x-auto'), label).not.toBeNull();
    }
  }
}

describe.skipIf(!testServer)('every screen', () => {
  it('WB-12 every screen renders inside the shell with an accessible name on every control and visible focus', () =>
    inScreens(inTheShell));
  it('WB-12 every screen declares both colour schemes, carries the theme script and uses token classes only', () =>
    inScreens(bothSchemes));
  it('WB-12 every screen sets no fixed width and keeps wide content scrolling in its own container', () =>
    inScreens(phoneWidth));
});

describe('the registered screens', () => {
  it('WB-12 every file under views/screens is a registered screen', () => {
    const files = readdirSync('apps/uw-app/views/screens')
      .filter((file) => file.endsWith('.tsx'))
      .map((file) => file.replace(/\.tsx$/, ''))
      .sort();
    expect(screens.map((screen) => screen.name).sort()).toEqual(files);
  });
});
