import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import type { Clock } from '@uw/harness';
import { AGENT_PLANE_INDICATORS } from '../health/agent-plane.ts';
import { boardWorld, type BoardWorld } from '../testing/board-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';
import { healthPath } from './parts/paths.ts';

const clock: Clock = { now: () => new Date('2026-10-02T09:00:00.000Z') };
const PLATFORM = ['Deployed commit', 'Database', 'Queue', 'Live hub'];

async function inHealth(work: (world: BoardWorld) => Promise<void>): Promise<void> {
  await withAppDatabase(async (db: Database) => work(await boardWorld(db, clock)));
}

async function documentOf(world: BoardWorld, path = healthPath(), email = world.ianEmail) {
  const page = await getHtml(world.db, email, path, {}, clock);
  return new JSDOM(page.text).window.document;
}

function kpis(document: Document): readonly (readonly [string, string, string, string | null])[] {
  return [...document.querySelectorAll('main ul > li')].map((item) => {
    const [label, value, detail] = [...item.querySelectorAll('dt, dd')].map(
      (cell) => cell.textContent ?? '',
    );
    const href = item.querySelector('a')?.getAttribute('href') ?? null;
    return [label ?? '', value ?? '', detail ?? '', href] as const;
  });
}

async function everyIndicator(world: BoardWorld): Promise<void> {
  const shown = kpis(await documentOf(world));
  expect(shown.map(([label]) => label)).toEqual([
    ...PLATFORM,
    'Spend this month',
    'Spend breaker',
    'Runs today',
    'Live delegations',
    'Gate refusals this week',
    'Agent writes today',
    'Stale learnings',
    'GitHub sweep',
  ]);
  expect(shown.slice(4).map(([, , , href]) => href)).toEqual(
    AGENT_PLANE_INDICATORS.map((name) => healthPath(name)),
  );
  expect(shown.slice(0, 4).every(([, , , href]) => href === null)).toBe(true);
}

async function spendSideBySide(world: BoardWorld): Promise<void> {
  const spend = kpis(await documentOf(world)).find(([label]) => label === 'Spend this month');
  expect(spend?.[2]).toContain('$1.50 metered of $1,250.00 this month');
  expect(spend?.[2]).toContain('1,200 subscription tokens reported');
}

async function notWired(world: BoardWorld): Promise<void> {
  const hub = kpis(await documentOf(world)).find(([label]) => label === 'Live hub');
  expect(hub?.[1]).toBe('Not wired');
}

async function readableRows(world: BoardWorld): Promise<void> {
  const mine = await documentOf(world, healthPath('runs_today'), world.viewer.email);
  expect(mine.querySelectorAll('main table tbody tr')).toHaveLength(2);
  const theirs = await documentOf(world, healthPath('runs_today'), world.stranger.email);
  expect(theirs.querySelector('main table')).toBeNull();
  expect(theirs.querySelector('main [role="note"]')?.textContent).toBe(
    'Nothing to list for you here.',
  );
}

async function countsFormatted(world: BoardWorld): Promise<void> {
  const document = await documentOf(world, healthPath('runs_today'));
  const headers = [...document.querySelectorAll('main table thead th')].map(
    (cell) => cell.textContent,
  );
  const column = headers.indexOf('Tokens');
  expect(column).toBeGreaterThan(-1);
  const tokens = [...document.querySelectorAll('main table tbody tr')].map(
    (row) => row.querySelectorAll('td, th')[column]?.textContent,
  );
  expect([...tokens].sort()).toEqual(['1,200', '3,000']);
}

async function unknownIndicators(world: BoardWorld): Promise<void> {
  const page = (path: string) => getHtml(world.db, world.ianEmail, path, {}, clock);
  const missing = await page(healthPath('nowhere'));
  expect(missing.status).toBe(404);
  for (const path of ['/health/spendx', '/health/xbreaker', '/health/spend/x']) {
    const answer = await page(path);
    expect([path, answer.status]).toEqual([path, 404]);
    expect(answer.text).toBe(missing.text);
  }
}

async function sameForEveryone(world: BoardWorld): Promise<void> {
  const plane = async (email: string) =>
    kpis(await documentOf(world, healthPath(), email)).slice(PLATFORM.length);
  const admin = await plane(world.ianEmail);
  expect(admin.find(([label]) => label === 'Runs today')?.[2]).not.toBe(
    '0 on the platform, 0 on own machines',
  );
  for (const email of [world.viewer.email, world.stranger.email]) {
    expect(await plane(email)).toEqual(admin);
  }
}

async function inTheShell(world: BoardWorld): Promise<void> {
  const page = await getHtml(world.db, world.ianEmail, healthPath(), {}, clock);
  const document = new JSDOM(page.text).window.document;
  expect(document.querySelector('nav a[href="/health"]')?.getAttribute('aria-current')).toBe(
    'page',
  );
  expect(document.querySelector('main h1')?.textContent).toBe('Health');
  expect(document.querySelector('main h1 + p')?.textContent).toMatch(/^Overall status: /);
  expect(await screenProblems(page.text)).toEqual([]);
  for (const name of AGENT_PLANE_INDICATORS) {
    const list = await getHtml(world.db, world.viewer.email, healthPath(name), {}, clock);
    expect(await screenProblems(list.text)).toEqual([]);
  }
}

describe.skipIf(!testServer)('/health and its drill-through', () => {
  it('WB-10 /health shows every indicator, each linking to its drill-through', () =>
    inHealth(everyIndicator));
  it('WB-10 spend shows metered cost and reported subscription tokens side by side', () =>
    inHealth(spendSideBySide));
  it('WB-10 an indicator whose source is not built says not wired', () => inHealth(notWired));
  it('WB-10 every person sees the same aggregates, whatever their grants', () =>
    inHealth(sameForEveryone));
  it('WB-10 a drill-through lists only rows the person can read', () => inHealth(readableRows));
  it('a drill-through writes its counts with thousands separators', () =>
    inHealth(countsFormatted));
  it('an unknown indicator, even one that starts or ends with a known name, answers the not-found page', () =>
    inHealth(unknownIndicators));
  it('WB-10 /health renders in the shell with no screen problems', () => inHealth(inTheShell));
});
