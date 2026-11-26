import { describe, expect, it } from 'vitest';
import { createLogger, type Logger } from '@uw/core/log';
import type { Bindings } from '../env.ts';
import { failingBrowser, fakeBrowser } from '../testing/browser.ts';
import { browserPng, pngRasteriserOf, recordingPng, type ChartRasteriser } from './png.ts';

const job = {
  title: 'Cumulative flow',
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 280"><title>Cumulative flow</title></svg>',
  width: 1080,
  height: 280,
};

const context = {
  traceId: 'trace-1',
  commit: 'test',
  route: 'GET /api/charts/:key',
  principal: null,
};
const quiet = createLogger(context, () => undefined);

function loggedInto(lines: Record<string, unknown>[]): Logger {
  return createLogger(context, (line) => lines.push(JSON.parse(line) as Record<string, unknown>));
}

const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const adapters: readonly (readonly [string, () => ChartRasteriser])[] = [
  ['the Browser Run adapter over a fake browser', () => browserPng(fakeBrowser(), quiet)],
  ['the recording adapter', recordingPng],
];

describe.each(adapters)('#199 the chart rasteriser contract on %s', (_name, make) => {
  it('#199 answers the bytes of a PNG for a chart', async () => {
    const bytes = await make().png(job);
    expect([...(bytes ?? new Uint8Array()).slice(0, 8)]).toEqual(signature);
  });
});

describe('#199 the Browser Run adapter draws the chart self-contained, with nothing fetched', () => {
  it('#199 sends one HTML document holding the SVG and the stylesheet, JavaScript off, only data: requests, no cache', async () => {
    const browser = fakeBrowser();
    await browserPng(browser, quiet).png(job);
    const [call] = browser.screenshots();
    expect(call?.html).toContain(job.svg);
    expect(call?.html).toContain('<style>');
    expect(call?.html).not.toMatch(/<link\b|<script\b|url\(\s*['"]?https?:|(?:src|href)="https?:/);
    expect(call).toMatchObject({
      screenshotOptions: { type: 'png', omitBackground: false },
      viewport: { width: 1080, height: 280, deviceScaleFactor: 2 },
      setJavaScriptEnabled: false,
      allowRequestPattern: ['^data:'],
      cacheTTL: 0,
    });
  });

  it('#199 answers null and logs a closed-set outcome when the browser fails', async () => {
    const lines: Record<string, unknown>[] = [];
    expect(await browserPng(failingBrowser(), loggedInto(lines)).png(job)).toBeNull();
    expect(lines[0]).toMatchObject({ outcome: 'chart_png_failed', status: 500 });
  });

  it('#199 has no rasteriser where the Worker has no browser binding', () => {
    const env: Bindings = {};
    expect(pngRasteriserOf(env, quiet)).toBeNull();
    expect(pngRasteriserOf({ BROWSER: fakeBrowser() }, quiet)).not.toBeNull();
  });
});
