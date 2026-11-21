import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedBreakerReading, seedGrant, seedPage, seedPerson } from '@uw/db/test-seed';
import type { Clock } from '@uw/harness';
import { accountMenuId } from '@uw/ui/components/account-menu.tsx';
import { appCss } from '@uw/ui/generated/app-css';
import { fontFiles } from '@uw/ui/generated/fonts';
import { wordmarkBase64, wordmarkPath } from '@uw/ui/generated/mark';
import { boardWorld, type BoardWorld } from '../testing/board-world.ts';
import { callerOf } from '../testing/commands.ts';
import { cast } from '../testing/credentials-app.ts';
import { credentialsScene } from '../testing/credentials-scene.ts';
import { gateWorld } from '../testing/gate-world.ts';
import { kernelOn } from '../testing/kernel.ts';
import { seedSampleKnowledge } from '../testing/knowledge.ts';
import { ensureBuiltIns } from '../collections/builtins/seed.ts';
import { personWith, rowIn } from '../testing/collections.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { getHtml } from '../testing/views.ts';
import {
  accessPath,
  agentQueuesPath,
  newWorkflowPath,
  queuePath,
  controlsPath,
  credentialPath,
  credentialsPath,
  flowPath,
  gatePath,
  healthPath,
  homePath,
  itemPath,
  agentsPath,
  newAgentPath,
  pageCommentsPath,
  pageEditPath,
  pageManagePath,
  pageVersionPath,
  pagePath,
  personaPath,
  personPath,
  runPath,
  runsPath,
  waitingPath,
  wikiAreaPath,
  wikiNewPath,
  wikiPath,
  wikiReviewPath,
} from '../views/parts/paths.ts';

const seedClock: Clock = { now: () => new Date('2026-10-02T06:00:00.000Z') };
const viewClock: Clock = { now: () => new Date('2026-10-02T09:00:00.000Z') };
const pictures = new URL('./pictures/', import.meta.url);
const update = process.env['UW_SCREENS_UPDATE'] === '1';
const required = process.env['UW_SCREENS'] === 'required';
const browsers =
  process.env['PLAYWRIGHT_BROWSERS_PATH'] ?? join(homedir(), '.cache', 'ms-playwright');
const browserReady =
  existsSync(browsers) &&
  readdirSync(browsers).some((entry) => entry.startsWith('chromium_headless_shell-'));
const MAX_DIFFERING = 0.005;

const widths = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const;
const themes = ['dark', 'light'] as const;

type Screen = { readonly name: string; readonly html: string; readonly opens?: string };

const anyId = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

function inlined(): string {
  let css = appCss;
  for (const font of fontFiles)
    css = css.replaceAll(`url(${font.path})`, `url(data:font/woff2;base64,${font.base64})`);
  return css;
}

export function settled(html: string, css: string): string {
  return html
    .replace(/<link rel="stylesheet" href="[^"]+"\/>/, `<style>${css}</style>`)
    .replaceAll(wordmarkPath, `data:image/png;base64,${wordmarkBase64}`)
    .replace(/<script type="module"[^>]*><\/script>/, '')
    .replace(anyId, '00000000-0000-4000-8000-000000000000')
    .replace(/db \d+ ms/g, 'db 0 ms');
}

async function personaOn(db: Database, harnessId: string): Promise<string> {
  const pageId = '00000000-0000-4000-8000-00000000c0de';
  await seedPage(db, {
    id: pageId,
    type: 'persona',
    status: 'suggested',
    jdArea: '80-89',
    slug: 'persona-builder',
    title: 'Builder',
    bodyMd: '---\nname: builder\ndescription: Builder turns a plan into commits.\n---\nWork.',
    frontmatter: {
      identity: 'agent:builder',
      owner: 'human:00000000-0000-4000-8000-000000000001',
      harness: harnessId,
      toolset: ['read_page', 'claim_item'],
      run_shape: 'workflow-run',
      engine: 'claude-messages',
      model: 'claude-sonnet-5',
      provider: 'anthropic',
      budget: { monthly_minor: 20000, currency: 'USD' },
      capability: 'build',
      requires_tools: ['read_page', 'claim_item'],
      status: 'suggested',
    },
  });
  return pageId;
}

const watcherEmail = 'flow.watcher@unfoldingword.org';

async function drafted(world: BoardWorld): Promise<void> {
  const watcher = '00000000-0000-4000-8000-00000000a0a1';
  await seedPerson(world.db, { id: watcher, email: watcherEmail });
  await seedGrant(world.db, {
    id: '00000000-0000-4000-8000-00000000a0a2',
    personId: watcher,
    role: 'admin',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  const kernel = kernelOn(world.db, { now: () => new Date('2026-10-02T08:56:00.000Z') });
  const opened = await kernel.drafts.open(callerOf(world.rowan), { harnessId: world.harnessId });
  if (opened.status !== 'accepted') throw new Error(`refused: ${opened.reason}`);
}

async function draftScreens(world: BoardWorld): Promise<Screen[]> {
  await drafted(world);
  const path = flowPath(world.harnessId);
  const mine = await getHtml(world.db, world.rowanEmail, path, {}, viewClock);
  const theirs = await getHtml(world.db, watcherEmail, path, {}, viewClock);
  return [
    { name: 'flow-draft', html: mine.text },
    { name: 'flow-locked', html: theirs.text },
  ];
}

async function memberScreens(world: BoardWorld): Promise<Screen[]> {
  const headers = { accept: 'text/html' };
  const read = (path: string) => getHtml(world.db, world.viewer.email, path, headers, viewClock);
  const member = await read(controlsPath(world.harnessId));
  const flowMember = await read(flowPath(world.harnessId));
  return [
    { name: 'controls-member', html: member.text },
    { name: 'flow-member', html: flowMember.text },
  ];
}

async function boardScreens(db: Database): Promise<Screen[]> {
  const world = await boardWorld(db, seedClock);
  const pageId = await personaOn(db, world.harnessId);
  const knowledgeId = await seedSampleKnowledge(db);
  await seedBreakerReading(db, {
    harnessId: world.harnessId,
    at: new Date('2026-10-02T08:30:00.000Z'),
    actor: 'agent:system',
    percent: 12,
  });
  const paths: readonly (readonly [string, string])[] = [
    ['home', homePath()],
    ['agent-queues', agentQueuesPath()],
    ['new-workflow', newWorkflowPath()],
    ['queue', queuePath(world.harnessId)],
    ['flow', flowPath(world.harnessId)],
    ['controls-admin', controlsPath(world.harnessId)],
    ['agents', agentsPath(world.harnessId)],
    ['runs', runsPath(world.harnessId)],
    ['run', runPath(world.harnessId, world.meteredRunId)],
    ['new-agent', newAgentPath(world.harnessId)],
    ['health', healthPath()],
    ['health-detail', healthPath('breaker')],
    ['access', accessPath()],
    ['person', personPath(world.rowan.personId ?? '', 'Rowan Test')],
    ['persona', personaPath(pageId)],
    ['page', pagePath(pageId)],
    ['knowledge-page', pagePath(knowledgeId)],
    ['page-edit', pageEditPath(knowledgeId)],
    ['wiki', wikiPath()],
    ['wiki-category', wikiPath('81')],
    ['wiki-new', wikiNewPath({ category: '81' })],
    ['page-manage', pageManagePath(knowledgeId)],
    ['page-version', pageVersionPath(knowledgeId, 1)],
    ['page-comments', pageCommentsPath(knowledgeId)],
    ['wiki-review', wikiReviewPath()],
    ['wiki-area', wikiAreaPath('80-89')],
    ['search', '/search?q=assessment'],
  ];
  const headers = { accept: 'text/html' };
  const screens: Screen[] = [];
  for (const [name, path] of paths) {
    const page = await getHtml(db, world.rowanEmail, path, headers, viewClock);
    screens.push({ name, html: page.text });
  }
  return [...screens, ...(await memberScreens(world)), ...(await draftScreens(world))];
}

async function gateScreens(db: Database): Promise<Screen[]> {
  const world = await gateWorld(db);
  const { harnessId, itemId } = world.item;
  const paths: readonly (readonly [string, string])[] = [
    ['waiting', waitingPath(harnessId)],
    ['gate', gatePath(harnessId, itemId)],
    ['play', itemPath(harnessId, itemId)],
  ];
  const screens: Screen[] = [];
  for (const [name, path] of paths) {
    const page = await getHtml(db, world.kimEmail, path, {}, viewClock);
    screens.push({ name, html: page.text });
  }
  return screens;
}

async function credentialScreens(db: Database): Promise<Screen[]> {
  const scene = await credentialsScene(db, seedClock);
  const one = credentialPath(scene.bankExport);
  const shots: readonly (readonly [string, string, string])[] = [
    ['credentials', cast.admin.email, credentialsPath()],
    ['credential', cast.admin.email, one],
    ['credential-member', cast.viewer.email, one],
  ];
  const screens: Screen[] = [];
  for (const [name, email, path] of shots) {
    const page = await getHtml(db, email, path, {}, viewClock);
    screens.push({ name, html: page.text });
  }
  return screens;
}

const viewPath = (key: string, n: number, query = '') =>
  `/collections/${key}/views/c0110000-0000-4000-8000-${String(n).padStart(12, '0')}${query}`;

async function collectionWorld(db: Database) {
  await ensureBuiltIns(db, seedClock.now());
  const ana = await personWith(db, 'ana.collections', [
    { role: 'admin', area: '00-09' },
    { role: 'editor', area: '60-69' },
  ]);
  const area = { jdArea: '60-69' };
  const portfolio = await rowIn(db, ana, {
    ...area,
    collection: 'portfolio',
    title: 'Bible translation',
  });
  const program = await rowIn(db, ana, {
    ...area,
    collection: 'program',
    title: 'Gateway languages',
    values: { portfolio, phase: 'active', health: 'on_track', lead: ana.personId },
  });
  await rowIn(db, ana, {
    ...area,
    collection: 'program',
    title: 'Oral Bible stories',
    values: { phase: 'idea', health: 'at_risk' },
  });
  await rowIn(db, ana, {
    ...area,
    collection: 'project',
    title: 'Nairobi workshop',
    values: {
      program,
      phase: 'underway',
      training_event_id: 'EV-1',
      duration: { start: '2026-10-05', end: '2026-10-07' },
    },
  });
  await rowIn(db, ana, {
    ...area,
    collection: 'tasks',
    title: 'Book the venue',
    values: {
      assignees: [ana.personId],
      status: 'in_progress',
      due: '2026-10-04',
      priority: 'high',
    },
  });
  return { email: ana.email ?? '', program };
}

async function collectionScreens(db: Database): Promise<Screen[]> {
  const world = await collectionWorld(db);
  const shots: readonly (readonly [string, string])[] = [
    ['collections', '/collections'],
    ['collection-board', viewPath('program', 401)],
    ['collection-table', viewPath('program', 403)],
    ['collection-chart', viewPath('program', 404)],
    ['collection-calendar', viewPath('project', 505, '?month=2026-10')],
    ['collection-gallery', viewPath('project', 510)],
    ['collection-list', viewPath('tasks', 101)],
    ['collection-row', `/collections/program/rows/${world.program}`],
    ['collection-settings', '/collections/program/settings'],
  ];
  const screens: Screen[] = [];
  for (const [name, path] of shots) {
    const page = await getHtml(db, world.email, path, {}, viewClock);
    screens.push({ name, html: page.text });
  }
  return screens;
}

const closedMenu = /(<section[^>]*aria-label="Menu"[^>]*>)<details>/;

function menuOpen(all: readonly Screen[]): Screen {
  const home = all.find((screen) => screen.name === 'home');
  if (home === undefined || !closedMenu.test(home.html)) throw new Error('no closed menu on home');
  return { name: 'menu', html: home.html.replace(closedMenu, '$1<details open="">') };
}

function accountMenuOpen(all: readonly Screen[]): Screen {
  const home = all.find((screen) => screen.name === 'home');
  if (home === undefined) throw new Error('no home');
  return { name: 'account-menu', html: home.html, opens: accountMenuId };
}

type Taken = {
  readonly picture: Buffer;
  readonly windowScrolls: boolean;
  readonly popover: readonly string[];
};

async function popoverOpen(page: Page, id: string): Promise<boolean> {
  return page.evaluate(
    (menu) => document.getElementById(menu)?.matches(':popover-open') === true,
    id,
  );
}

async function openPopover(page: Page, id: string): Promise<string[]> {
  const faults: string[] = [];
  const button = page.locator(`button[popovertarget="${id}"]:visible`);
  if ((await button.count()) !== 1) return ['not exactly one visible button opens the menu'];
  await button.click();
  if (!(await popoverOpen(page, id))) faults.push('a click does not open the menu');
  await page.keyboard.press('Escape');
  if (await popoverOpen(page, id)) faults.push('Esc does not close the menu');
  const back = await button.evaluate((control) => control === document.activeElement);
  if (!back) faults.push('focus does not return to the button');
  await page.keyboard.press('Enter');
  if (!(await popoverOpen(page, id))) faults.push('Enter does not open the menu');
  const content = await page.locator('main').boundingBox();
  if (content === null) return [...faults, 'no content to click outside the menu'];
  await page.mouse.click(content.x + 2, content.y + 2);
  if (await popoverOpen(page, id)) faults.push('a click outside does not close the menu');
  await button.focus();
  await page.keyboard.press('Space');
  if (!(await popoverOpen(page, id))) faults.push('Space does not open the menu');
  return faults;
}

async function shoot(browser: Browser, screen: Screen, css: string, shot: Shot): Promise<Taken> {
  const html = settled(screen.html, css);
  const page = await browser.newPage({
    viewport: { width: shot.width, height: shot.height },
    colorScheme: shot.theme,
    deviceScaleFactor: 1,
  });
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const windowScrolls = await page.evaluate(
      () => document.documentElement.scrollHeight > document.documentElement.clientHeight,
    );
    const popover = screen.opens === undefined ? [] : await openPopover(page, screen.opens);
    return { picture: await page.screenshot({ animations: 'disabled' }), windowScrolls, popover };
  } finally {
    await page.close();
  }
}

type Shot = {
  readonly width: number;
  readonly height: number;
  readonly theme: 'dark' | 'light';
};

export function differing(actual: Buffer, expected: Buffer): number {
  const left = PNG.sync.read(actual);
  const right = PNG.sync.read(expected);
  if (left.width !== right.width || left.height !== right.height) return 1;
  const diff = pixelmatch(left.data, right.data, undefined, left.width, left.height, {
    threshold: 0.1,
  });
  return diff / (left.width * left.height);
}

let browser: Browser | null = null;
let screens: Screen[] = [];

beforeAll(async () => {
  if (!testServer || !browserReady) return;
  browser = await chromium.launch();
  await withAppDatabase(async (db) => {
    screens = [...screens, ...(await boardScreens(db))];
  });
  await withAppDatabase(async (db) => {
    screens = [...screens, ...(await gateScreens(db))];
  });
  await withAppDatabase(async (db) => {
    screens = [...screens, ...(await credentialScreens(db))];
  });
  await withAppDatabase(async (db) => {
    screens = [...screens, ...(await collectionScreens(db))];
  });
  screens = [...screens, menuOpen(screens), accountMenuOpen(screens)];
}, 300_000);

afterAll(async () => {
  await browser?.close();
});

function pictureOf(name: string): URL {
  return new URL(name, pictures);
}

async function compareAll(css: string): Promise<string[]> {
  const failures: string[] = [];
  if (browser === null) throw new Error('no browser');
  for (const screen of screens)
    for (const size of widths)
      for (const theme of themes) {
        const name = `${screen.name}-${size.name}-${theme}.png`;
        const taken = await shoot(browser, screen, css, { ...size, theme });
        const shot = taken.picture;
        failures.push(...taken.popover.map((fault) => `${name}: ${fault}`));
        if (size.name === 'desktop' && taken.windowScrolls)
          failures.push(`${name}: the window scrolls, only the content should`);
        if (update) {
          mkdirSync(pictures, { recursive: true });
          writeFileSync(pictureOf(name), shot);
          continue;
        }
        const committed = pictureOf(name);
        if (!existsSync(committed)) {
          failures.push(`${name}: no committed picture`);
          continue;
        }
        const share = differing(shot, readFileSync(committed));
        if (share >= MAX_DIFFERING)
          failures.push(`${name}: ${(share * 100).toFixed(2)} percent differs`);
      }
  return failures;
}

const pictured = [
  'home',
  'agent-queues',
  'new-workflow',
  'queue',
  'flow',
  'controls-admin',
  'agents',
  'runs',
  'run',
  'new-agent',
  'health',
  'health-detail',
  'access',
  'person',
  'persona',
  'page',
  'knowledge-page',
  'page-edit',
  'wiki',
  'wiki-category',
  'wiki-new',
  'page-manage',
  'page-version',
  'page-comments',
  'wiki-review',
  'wiki-area',
  'search',
  'controls-member',
  'flow-member',
  'flow-draft',
  'flow-locked',
  'waiting',
  'gate',
  'play',
  'credentials',
  'credential',
  'credential-member',
  'collections',
  'collection-board',
  'collection-table',
  'collection-chart',
  'collection-calendar',
  'collection-gallery',
  'collection-list',
  'collection-row',
  'collection-settings',
  'menu',
  'account-menu',
];

describe.skipIf(!testServer || (!browserReady && !required))('UI-16 the screenshot check', () => {
  it('UI-16 the browser the check needs is installed', () => {
    expect(browserReady).toBe(true);
  });

  it('UI-16 every screen in light and dark, desktop and phone, matches its committed picture', async () => {
    expect(screens.map((screen) => screen.name)).toEqual(pictured);
    expect(await compareAll(inlined())).toEqual([]);
  }, 600_000);

  it.skipIf(update)(
    'UI-16 a planted change to a token value fails the check',
    async () => {
      const planted = inlined().replace('--uw-inspire-400:#31ade3', '--uw-inspire-400:#ff00aa');
      expect(planted).not.toBe(inlined());
      const failures = await compareAll(planted);
      expect(failures.length).toBeGreaterThan(0);
    },
    600_000,
  );
});
