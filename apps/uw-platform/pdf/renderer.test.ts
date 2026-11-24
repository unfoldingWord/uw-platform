import { describe, expect, it } from 'vitest';
import { createLogger, type Logger } from '@uw/core/log';
import { printMetrics } from '@uw/ui/generated/app-css';
import type { Bindings } from '../env.ts';
import { failingBrowser, fakeBrowser } from '../testing/browser.ts';
import {
  browserPdf,
  pdfRendererOf,
  recordingPdf,
  type PdfRenderer,
  type PrintJob,
} from './renderer.ts';

const job: PrintJob = {
  title: 'Security guidelines',
  html: '<!DOCTYPE html><html><body><main>Lock the door.</main></body></html>',
  header: '<div>header</div>',
  footer: '<div><span class="pageNumber"></span></div>',
};

const context = { traceId: 'trace-1', commit: 'test', route: 'GET /pages/:id', principal: null };

function loggedInto(lines: Record<string, unknown>[]): Logger {
  return createLogger(context, (line) => lines.push(JSON.parse(line) as Record<string, unknown>));
}

const quiet = loggedInto([]);

const text = (bytes: Uint8Array | null): string => new TextDecoder().decode(bytes ?? undefined);

const adapters: readonly (readonly [string, () => PdfRenderer])[] = [
  ['the Browser Run adapter over a fake browser', () => browserPdf(fakeBrowser(), quiet)],
  ['the recording adapter', recordingPdf],
];

describe.each(adapters)('#198 the PDF renderer contract on %s', (_name, make) => {
  it('#198 answers the bytes of a PDF document for a print job', async () => {
    const bytes = await make().render(job);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(text(bytes).startsWith('%PDF-')).toBe(true);
  });

  it('#198 renders every job it is given, one after another', async () => {
    const renderer = make();
    const first = await renderer.render(job);
    const second = await renderer.render({ ...job, title: 'Second', html: '<p>Second</p>' });
    expect(text(first).startsWith('%PDF-')).toBe(true);
    expect(text(second).startsWith('%PDF-')).toBe(true);
  });
});

describe('#198 the Browser Run adapter', () => {
  it('#198 prints self-contained HTML with no network, no script, no cache and the print tokens', async () => {
    const browser = fakeBrowser();
    await browserPdf(browser, quiet).render(job);
    expect(browser.calls()).toEqual([
      {
        html: job.html,
        pdfOptions: {
          format: printMetrics.paper,
          printBackground: true,
          preferCSSPageSize: false,
          displayHeaderFooter: true,
          headerTemplate: job.header,
          footerTemplate: job.footer,
          margin: { ...printMetrics.margin },
          outline: true,
          tagged: true,
        },
        emulateMediaType: 'print',
        setJavaScriptEnabled: false,
        allowRequestPattern: ['^data:'],
        cacheTTL: 0,
      },
    ]);
  });
});

describe('#198 the Browser Run adapter when a render fails', () => {
  it('#198 answers null when the browser answers an error, and logs its status once without the HTML', async () => {
    const lines: Record<string, unknown>[] = [];
    expect(await browserPdf(failingBrowser(), loggedInto(lines)).render(job)).toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'warn',
      message: 'pdf render failed',
      outcome: 'pdf_render_failed',
      status: 500,
      trace_id: 'trace-1',
    });
    expect(String(lines[0]?.body_excerpt)).toContain('render failed');
    expect(JSON.stringify(lines)).not.toContain('Lock the door');
  });

  it('#198 leaves out a body that is HTML, which could echo the page', async () => {
    const lines: Record<string, unknown>[] = [];
    const echoing = {
      quickAction: async (): Promise<Response> =>
        new Response(job.html, { status: 502, headers: { 'content-type': 'text/html' } }),
    };
    expect(await browserPdf(echoing, loggedInto(lines)).render(job)).toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ status: 502, outcome: 'pdf_render_failed' });
    expect(JSON.stringify(lines)).not.toContain('Lock the door');
  });

  it('#198 answers null when the browser binding throws, and logs the error name and message', async () => {
    const lines: Record<string, unknown>[] = [];
    const throwing = {
      quickAction: async (): Promise<Response> => {
        throw new TypeError('browser unavailable');
      },
    };
    expect(await browserPdf(throwing, loggedInto(lines)).render(job)).toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      outcome: 'pdf_render_failed',
      error_name: 'TypeError',
      error_message: 'browser unavailable',
    });
  });
});

describe('#198 the recording adapter', () => {
  it('#198 keeps every job it was given, in order', async () => {
    const renderer = recordingPdf();
    await renderer.render(job);
    await renderer.render({ ...job, title: 'Second' });
    expect(renderer.jobs().map((kept) => kept.title)).toEqual(['Security guidelines', 'Second']);
  });
});

describe('#198 the renderer of a Worker', () => {
  it('#198 is the Browser Run adapter when BROWSER is bound, and none when it is not', async () => {
    const bound: Bindings = { BROWSER: fakeBrowser() };
    expect(pdfRendererOf({}, quiet)).toBeNull();
    expect(text(await (pdfRendererOf(bound, quiet)?.render(job) ?? null)).startsWith('%PDF-')).toBe(
      true,
    );
  });
});
