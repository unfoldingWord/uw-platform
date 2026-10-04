import { eq } from 'drizzle-orm';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { ItemState, Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { harnessItems, harnessRuns } from '@uw/db/schema';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { clock, instant, parkAtShip, people } from '../github/testing/ship-rig.ts';
import { accepted, callerOf } from '../testing/commands.ts';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';
import { flowPath, gatePath, itemPath } from './paths.ts';

const HOUR = 3_600_000;
const IAN = 'ian.lindsley@unfoldingword.org';
const KIM = 'person6@unfoldingword.org';
const VIEWER = {
  id: '00000000-0000-4000-8000-000000007301',
  email: 'home-viewer@unfoldingword.org',
};

type Home = { readonly item: ItemState; readonly ian: Principal };

function earlier(hours: number): Date {
  return new Date(instant.getTime() - hours * HOUR);
}

async function lapsedDelegation(db: Database, home: Home): Promise<void> {
  const kernel = kernelOn(db, { now: () => earlier(3) });
  accepted(
    await kernel.delegations.grant(callerOf(home.ian), {
      harnessId: home.item.harnessId,
      persona: 'agent:scout',
      capability: 'build',
      expiresAt: earlier(1),
      supersedes: null,
    }),
  );
}

async function failedRun(db: Database, home: Home): Promise<void> {
  await db.insert(harnessRuns).values({
    id: '00000000-0000-4000-8000-000000007310',
    harnessId: home.item.harnessId,
    itemId: home.item.itemId,
    persona: `agent:${home.ian.personId ?? ''}/laptop`,
    delegationId: null,
    runShape: 'external-run',
    engine: 'external',
    model: 'claude-sonnet-5',
    costBasis: 'subscription',
    traceId: '00000000-0000-4000-8000-000000007311',
    outcome: 'failed',
    failure: 'retries_exhausted',
    startedAt: earlier(2),
    endedAt: earlier(1.5),
  });
}

async function seeded(db: Database): Promise<Home> {
  const { ian } = await people(db);
  const item = await parkAtShip(kernelOn(db, clock), ian);
  const home = { item, ian };
  await lapsedDelegation(db, home);
  await failedRun(db, home);
  return home;
}

function homeOf(db: Database, email: string, headers: Readonly<Record<string, string>> = {}) {
  return getHtml(db, email, '/', headers, clock);
}

function linksOf(html: string): readonly [string | null, string][] {
  const { document } = new JSDOM(html).window;
  return [...document.querySelectorAll('main li a')].map((link) => [
    link.getAttribute('href'),
    link.textContent ?? '',
  ]);
}

async function listsInOrder(db: Database): Promise<void> {
  const { item } = await seeded(db);
  const page = await homeOf(db, IAN);
  expect(page.status).toBe(200);
  expect(linksOf(page.text)).toEqual([
    [gatePath(item.harnessId, item.itemId), 'Decide Show the board at Merge, tag, deploy'],
    [
      flowPath(item.harnessId),
      'Your delegation to agent:scout on software lapsed 2026-10-02 08:00 UTC',
    ],
    [itemPath(item.harnessId, item.itemId), 'A run failed on Show the board: Retries exhausted'],
  ]);
}

async function countIsRows(db: Database): Promise<void> {
  await seeded(db);
  const page = await homeOf(db, IAN);
  const { document } = new JSDOM(page.text).window;
  expect(document.querySelector('main h1')?.textContent).toBe('Waiting on you');
  expect(document.querySelector('main h1 + p')?.textContent).toBe('3 things are waiting on you');
  expect(linksOf(page.text)).toHaveLength(3);
}

async function seedViewer(db: Database): Promise<void> {
  await seedPerson(db, VIEWER);
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000007302',
    personId: VIEWER.id,
    role: 'viewer',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: earlier(48),
    expiresAt: null,
  });
}

async function emptyHome(db: Database): Promise<void> {
  await seeded(db);
  await seedViewer(db);
  const page = await homeOf(db, VIEWER.email);
  expect(page.status).toBe(200);
  expect(linksOf(page.text)).toEqual([]);
  const { document } = new JSDOM(page.text).window;
  expect(document.querySelector('main [role="note"]')?.textContent).toBe(
    'Nothing is waiting on you right now.',
  );
}

async function highItemHidden(db: Database): Promise<void> {
  const { item } = await seeded(db);
  const gate = gatePath(item.harnessId, item.itemId);
  expect(linksOf((await homeOf(db, KIM)).text).map(([href]) => href)).toEqual([gate]);
  await db
    .update(harnessItems)
    .set({ riskTier: 'high', riskDomains: ['acl'] })
    .where(eq(harnessItems.id, item.itemId));
  expect(linksOf((await homeOf(db, KIM)).text)).toEqual([]);
  expect(linksOf((await homeOf(db, IAN)).text).map(([href]) => href)).toContain(gate);
}

async function fragmentOnly(db: Database): Promise<void> {
  const { item } = await seeded(db);
  const page = await homeOf(db, IAN, { 'x-uw-fragment': 'main' });
  expect(page.status).toBe(200);
  expect(page.headers.get('cache-control')).toBe('no-store');
  expect(page.headers.get('vary')).toBe('x-uw-fragment');
  expect(page.text).not.toMatch(/<html|<main|<nav|<!DOCTYPE/i);
  const marker = `<div data-live="" data-live-harness="${item.harnessId}" data-cursor="`;
  expect(page.text.startsWith(marker)).toBe(true);
  expect(page.text.slice(marker.length)).toMatch(/^[1-9]\d*" data-refresh-every="60000"><\/div>/);
  expect(page.text).toContain('data-refresh-every="60000"');
  expect(page.text).toContain('Decide Show the board at Merge, tag, deploy');
}

async function noProblems(db: Database): Promise<void> {
  await seeded(db);
  const page = await homeOf(db, IAN);
  expect(await screenProblems(page.text)).toEqual([]);
  await seedViewer(db);
  expect(await screenProblems((await homeOf(db, VIEWER.email)).text)).toEqual([]);
}

describe.skipIf(!testServer)('Home', () => {
  it('WB-9 Home lists the gates the person can decide, then lapsed delegations, then failed runs, each deep-linked', () =>
    withAppDatabase(listsInOrder));
  it('WB-9 the count Home shows is the number of rows it lists', () =>
    withAppDatabase(countIsRows));
  it('WB-9 an empty Home says nothing is waiting', () => withAppDatabase(emptyHome));
  it('WB-9 a high item the person lacks the domain grant for is not on Home', () =>
    withAppDatabase(highItemHidden));
  it('the main fragment answers only the main content with no shell', () =>
    withAppDatabase(fragmentOnly));
  it('Home renders with no screen problems', () => withAppDatabase(noProblems));
});
