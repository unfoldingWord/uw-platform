import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedBreakerReading, seedPage } from '@uw/db/test-seed';
import type { Clock } from '@uw/harness';
import { appCss } from '@uw/ui/generated/app-css';
import { fontFiles } from '@uw/ui/generated/fonts';
import { wordmarkBase64, wordmarkPath } from '@uw/ui/generated/mark';
import { boardWorld } from '../testing/board-world.ts';
import { gateWorld } from '../testing/gate-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { getHtml } from '../testing/views.ts';
import {
  boardPath,
  flowPath,
  gatePath,
  gatesPath,
  healthPath,
  homePath,
  itemPath,
  personaPath,
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

type Screen = { readonly name: string; readonly html: string };

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

async function boardScreens(db: Database): Promise<Screen[]> {
  const world = await boardWorld(db, seedClock);
  const pageId = await personaOn(db, world.harnessId);
  await seedBreakerReading(db, {
    harnessId: world.harnessId,
    at: new Date('2026-10-02T08:30:00.000Z'),
    actor: 'agent:system',
    percent: 12,
  });
  const paths: readonly (readonly [string, string])[] = [
    ['home', homePath()],
    ['board', boardPath(world.harnessId)],
    ['flow', flowPath(world.harnessId)],
    ['health', healthPath()],
    ['health-detail', healthPath('breaker')],
    ['persona', personaPath(pageId)],
  ];
  const headers = { accept: 'text/html' };
  const screens: Screen[] = [];
  for (const [name, path] of paths) {
    const page = await getHtml(db, world.ianEmail, path, headers, viewClock);
    screens.push({ name, html: page.text });
  }
  return screens;
}

async function gateScreens(db: Database): Promise<Screen[]> {
  const world = await gateWorld(db);
  const { harnessId, itemId } = world.item;
  const paths: readonly (readonly [string, string])[] = [
    ['gates', gatesPath()],
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

async function shoot(browser: Browser, html: string, shot: Shot): Promise<Buffer> {
  const page = await browser.newPage({
    viewport: { width: shot.width, height: shot.height },
    colorScheme: shot.theme,
    deviceScaleFactor: 1,
  });
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return await page.screenshot({ animations: 'disabled' });
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
        const shot = await shoot(browser, settled(screen.html, css), { ...size, theme });
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

describe.skipIf(!testServer || (!browserReady && !required))('UI-16 the screenshot check', () => {
  it('UI-16 the browser the check needs is installed', () => {
    expect(browserReady).toBe(true);
  });

  it('UI-16 every screen in light and dark, desktop and phone, matches its committed picture', async () => {
    expect(screens.map((screen) => screen.name)).toEqual([
      'home',
      'board',
      'flow',
      'health',
      'health-detail',
      'persona',
      'gates',
      'gate',
      'play',
    ]);
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
