import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { jsx } from 'hono/jsx';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Card } from '@uw/ui/components/card.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { Shell } from '@uw/ui/components/shell.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { appCss } from '@uw/ui/generated/app-css';
import { testFrame } from '../../../packages/ui/testing/frame.ts';

const required = process.env['UW_SCREENS'] === 'required';
const browsers =
  process.env['PLAYWRIGHT_BROWSERS_PATH'] ?? join(homedir(), '.cache', 'ms-playwright');
const browserReady =
  existsSync(browsers) &&
  readdirSync(browsers).some((entry) => entry.startsWith('chromium_headless_shell-'));

const columns = [
  { key: 'stage', label: 'Stage' },
  { key: 'status', label: 'Status' },
];

const rows = Array.from({ length: 80 }, (_, index) => ({
  stage: `Stage ${index + 1}`,
  status: 'Running',
}));

async function tallPage(): Promise<string> {
  const page = await jsx(
    Shell,
    {
      title: 'unfoldingWord',
      frame: testFrame(),
      current: '/',
      crumbs: [{ label: 'Home' }],
      stylesheet: '/assets/app-0123456789ab.css',
    },
    jsx(PageHead, { title: 'unfoldingWord', lede: 'A page taller than the window.' }),
    jsx(
      Card,
      { title: 'Stage details', flush: true },
      jsx(Table, { caption: 'Stages', columns, rows, bare: true }),
    ),
    jsx(
      Card,
      { title: 'Below the fold', flush: true },
      jsx(Table, { caption: 'Stages again', columns, rows, bare: true }),
    ),
  ).toString();
  return `<!DOCTYPE html>${page}`.replace(
    /<link rel="stylesheet" href="[^"]+"\/>/,
    `<style>${appCss}</style>`,
  );
}

type Sizes = {
  readonly window: readonly [number, number];
  readonly main: readonly [number, number];
  readonly caption: string;
};

let browser: Browser | null = null;

beforeAll(async () => {
  if (browserReady) browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

async function measure(width: number, height: number): Promise<Sizes> {
  if (browser === null) throw new Error('no browser');
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.setContent(await tallPage(), { waitUntil: 'load' });
    return await page.evaluate(() => {
      const root = document.documentElement;
      const main = document.querySelector('main');
      const caption = [...document.querySelectorAll('caption')].at(-1) ?? null;
      if (main === null || caption === null) throw new Error('no main or caption');
      return {
        window: [root.scrollHeight, root.clientHeight] as const,
        main: [main.scrollHeight, main.clientHeight] as const,
        caption: getComputedStyle(caption).position,
      };
    });
  } finally {
    await page.close();
  }
}

describe.skipIf(!browserReady && !required)('#145 on desktop only the content scrolls', () => {
  it('the browser the check needs is installed', () => {
    expect(browserReady).toBe(true);
  });

  it('a tall page with hidden text below the fold scrolls main and never the window', async () => {
    const sizes = await measure(1440, 900);
    expect(sizes.caption).toBe('absolute');
    expect(sizes.main[0]).toBeGreaterThan(sizes.main[1]);
    expect(sizes.window[0]).toBe(sizes.window[1]);
  });

  it('on a phone the window is the one scroll area', async () => {
    const sizes = await measure(390, 844);
    expect(sizes.window[0]).toBeGreaterThan(sizes.window[1]);
    expect(sizes.main[0]).toBe(sizes.main[1]);
  });
});
