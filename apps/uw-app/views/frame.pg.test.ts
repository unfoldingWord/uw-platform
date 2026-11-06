import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { clock, parkAtShip, people } from '../github/testing/ship-rig.ts';
import { callerOf } from '../testing/commands.ts';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml, getHtmlWithEnv } from '../testing/views.ts';
import { boardPath, gatesPath, healthPath } from './parts/paths.ts';

const IAN = 'ian.lindsley@unfoldingword.org';

function documentOf(html: string): Document {
  return new JSDOM(html).window.document;
}

function desktopNav(document: Document): Element {
  const nav = document.querySelector('aside nav[aria-label="Main"]');
  if (nav === null) throw new Error('no desktop navigation');
  return nav;
}

async function parked(db: Database) {
  const { ian } = await people(db);
  const kernel = kernelOn(db, clock);
  const item = await parkAtShip(db, kernel, ian);
  await kernel.stages.setTitle(callerOf(ian), { harnessId: item.harnessId, title: 'Software' });
  return item;
}

async function sidebarReadsTheFrame(db: Database): Promise<void> {
  const item = await parked(db);
  const document = documentOf((await getHtml(db, IAN, '/', {}, clock)).text);
  const nav = desktopNav(document);
  const waiting = nav.querySelector(`a[href="${gatesPath()}"]`);
  expect(waiting?.textContent).toContain('Waiting On You');
  expect(waiting?.querySelector('[aria-label$="waiting on you"]')?.textContent).toBe('1');
  const harness = nav.querySelector(`a[href="${boardPath(item.harnessId)}"]`);
  expect(harness?.textContent).toContain('Software');
  expect(harness?.textContent).toContain('1');
  expect(nav.querySelector(`a[href="${healthPath()}"]`)?.textContent).toContain('Health');
  const brand = document.querySelector('aside');
  expect(brand?.textContent).toContain('unfoldingWord');
  expect(brand?.textContent).toContain('Platform');
  expect(brand?.textContent).toContain('Ian Lindsley');
}

async function unwiredSaySo(db: Database): Promise<void> {
  await parked(db);
  const nav = desktopNav(documentOf((await getHtml(db, IAN, '/', {}, clock)).text));
  for (const label of ['My Items', 'Personas']) {
    const row = [...nav.querySelectorAll('[aria-disabled="true"]')].find((element) =>
      element.textContent?.includes(label),
    );
    expect(row?.textContent, label).toContain('Not wired yet');
  }
  const search = documentOf((await getHtml(db, IAN, '/', {}, clock)).text).querySelector(
    'aside [aria-disabled="true"]',
  );
  expect(search?.textContent).toContain('Not wired yet');
}

async function statusBarSays(db: Database): Promise<void> {
  await parked(db);
  const env = { COMMIT_SHA: 'bf10f9f9999999999999999999999999999999999', ENVIRONMENT: 'staging' };
  const html = await getHtmlWithEnv(db, IAN, '/', env, clock);
  const status = documentOf(html.text).querySelector('footer[aria-label="Status"]');
  const text = status?.textContent ?? '';
  expect(text).toContain('Loaded');
  expect(text).toContain('1 gate open');
  expect(text).toContain('0 agents');
  expect(text).toContain('queue off');
  expect(text).toContain('bf10f9f');
  expect(text).not.toContain('bf10f9f9');
  expect(text).toContain('staging');
  expect(text).toMatch(/db (?:\d+ ms|not measured)/);
}

async function phoneHeader(db: Database): Promise<void> {
  await parked(db);
  const document = documentOf((await getHtml(db, IAN, '/', {}, clock)).text);
  const phone = document.querySelector('section[aria-label="Menu"]');
  expect(phone?.querySelector('img')?.getAttribute('alt')).toBe('unfoldingWord');
  expect(phone?.textContent).toContain('Home');
  expect(phone?.querySelector('[aria-label$="waiting on you"]')?.textContent).toBe('1');
}

async function noProblems(db: Database): Promise<void> {
  await parked(db);
  expect(await screenProblems((await getHtml(db, IAN, '/', {}, clock)).text)).toEqual([]);
}

describe.skipIf(!testServer)('UI-5 the frame', () => {
  it('UI-5 the sidebar carries the mark, the counts, each harness by title and the person', () =>
    withAppDatabase(sidebarReadsTheFrame));
  it('UI-5 My Items, Personas and search say they are not wired', () =>
    withAppDatabase(unwiredSaySo));
  it('UI-5 the status bar says what loaded, what is open, what is on, the commit and where', () =>
    withAppDatabase(statusBarSays));
  it('UI-5 on a phone a header shows the mark, the page and the count waiting', () =>
    withAppDatabase(phoneHeader));
  it('UI-5 the framed page passes the screen checks in both themes', () =>
    withAppDatabase(noProblems));
});
