import type { Root } from 'hast';
import { errorFields, type Logger } from '@uw/core/log';
import type { Bindings, BrowserBinding, ScreenshotQuickAction } from '../env.ts';
import { stylesheet } from '../pdf/print-document.ts';
import { element, htmlOf, text } from '../pdf/print-html.ts';

export type PngJob = {
  readonly title: string;
  readonly svg: string;
  readonly width: number;
  readonly height: number;
};

export type ChartRasteriser = { png(job: PngJob): Promise<Uint8Array | null> };

const FAILED = 'chart png failed';
const OUTCOME = 'chart_png_failed';
const SCALE = 2;
const recorded =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function pngHtml(job: PngJob): string {
  const head = element('head', {}, [
    element('meta', { charSet: 'utf-8' }),
    element('title', {}, [text(job.title)]),
    element('style', {}, [text(stylesheet())]),
  ]);
  const body = element('body', { className: ['m-0', 'bg-surface', 'text-text'] }, [
    { type: 'raw', value: job.svg },
  ]);
  const tree: Root = {
    type: 'root',
    children: [
      { type: 'doctype' },
      element('html', { lang: 'en', dataTheme: 'light' }, [head, body]),
    ],
  };
  return htmlOf(tree);
}

function screenshotOf(job: PngJob): ScreenshotQuickAction {
  return {
    html: pngHtml(job),
    screenshotOptions: { type: 'png', omitBackground: false },
    viewport: { width: job.width, height: job.height, deviceScaleFactor: SCALE },
    setJavaScriptEnabled: false,
    allowRequestPattern: ['^data:'],
    cacheTTL: 0,
  };
}

async function shot(binding: BrowserBinding, logger: Logger, job: PngJob) {
  const response = await binding.quickAction('screenshot', screenshotOf(job));
  if (response.ok) return new Uint8Array(await response.arrayBuffer());
  logger.warn(FAILED, { outcome: OUTCOME, status: response.status });
  return null;
}

export function browserPng(binding: BrowserBinding, logger: Logger): ChartRasteriser {
  return {
    png: (job) =>
      shot(binding, logger, job).catch((error: unknown) => {
        logger.warn(FAILED, { outcome: OUTCOME, ...errorFields(error) });
        return null;
      }),
  };
}

export function recordingPng(): ChartRasteriser & { readonly jobs: () => readonly PngJob[] } {
  const jobs: PngJob[] = [];
  return {
    png: async (job) => {
      jobs.push(job);
      return Uint8Array.from(atob(recorded), (char) => char.charCodeAt(0));
    },
    jobs: () => [...jobs],
  };
}

export function pngRasteriserOf(env: Bindings, logger: Logger): ChartRasteriser | null {
  return env.BROWSER === undefined ? null : browserPng(env.BROWSER, logger);
}
