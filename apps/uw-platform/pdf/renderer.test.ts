import { describe, expect, it } from 'vitest';
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

const text = (bytes: Uint8Array | null): string => new TextDecoder().decode(bytes ?? undefined);

const adapters: readonly (readonly [string, () => PdfRenderer])[] = [
  ['the Browser Run adapter over a fake browser', () => browserPdf(fakeBrowser())],
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
    await browserPdf(browser).render(job);
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

  it('#198 answers null when the browser answers an error', async () => {
    expect(await browserPdf(failingBrowser()).render(job)).toBeNull();
  });

  it('#198 answers null when the browser binding throws', async () => {
    const throwing = {
      quickAction: async (): Promise<Response> => {
        throw new Error('browser unavailable');
      },
    };
    expect(await browserPdf(throwing).render(job)).toBeNull();
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
    expect(pdfRendererOf({})).toBeNull();
    expect(text(await (pdfRendererOf(bound)?.render(job) ?? null)).startsWith('%PDF-')).toBe(true);
  });
});
