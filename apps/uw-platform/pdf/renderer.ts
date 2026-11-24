import { errorFields, type Logger } from '@uw/core/log';
import { printMetrics } from '@uw/ui/generated/app-css';
import type { Bindings, BrowserBinding, PdfQuickAction } from '../env.ts';

export type PrintJob = {
  readonly title: string;
  readonly html: string;
  readonly header: string;
  readonly footer: string;
};

export type PdfRenderer = { render(job: PrintJob): Promise<Uint8Array | null> };

const recordedPdf = '%PDF-1.7\n%recorded\n%%EOF\n';
const FAILED = 'pdf render failed';
const OUTCOME = 'pdf_render_failed';
const EXCERPT_LIMIT = 200;
const URL_IN_TEXT = /[a-z][a-z0-9+.-]*:\/\/\S+/gi;

function quickActionOf(job: PrintJob): PdfQuickAction {
  return {
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
  };
}

async function excerptOf(response: Response): Promise<string | undefined> {
  if (response.headers.get('content-type')?.includes('html') === true) return undefined;
  const body = await response.text().catch(() => '');
  return body.replace(URL_IN_TEXT, '<url>').slice(0, EXCERPT_LIMIT);
}

async function printed(
  binding: BrowserBinding,
  logger: Logger,
  job: PrintJob,
): Promise<Uint8Array | null> {
  const response = await binding.quickAction('pdf', quickActionOf(job));
  if (response.ok) return new Uint8Array(await response.arrayBuffer());
  const excerpt = await excerptOf(response);
  logger.warn(FAILED, { outcome: OUTCOME, status: response.status, body_excerpt: excerpt });
  return null;
}

export function browserPdf(binding: BrowserBinding, logger: Logger): PdfRenderer {
  return {
    render: (job) =>
      printed(binding, logger, job).catch((error: unknown) => {
        logger.warn(FAILED, { outcome: OUTCOME, ...errorFields(error) });
        return null;
      }),
  };
}

export function recordingPdf(): PdfRenderer & { readonly jobs: () => readonly PrintJob[] } {
  const jobs: PrintJob[] = [];
  return {
    render: async (job) => {
      jobs.push(job);
      return new TextEncoder().encode(recordedPdf);
    },
    jobs: () => [...jobs],
  };
}

export function pdfRendererOf(env: Bindings, logger: Logger): PdfRenderer | null {
  return env.BROWSER === undefined ? null : browserPdf(env.BROWSER, logger);
}
