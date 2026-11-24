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

async function printed(binding: BrowserBinding, job: PrintJob): Promise<Uint8Array | null> {
  const response = await binding.quickAction('pdf', quickActionOf(job));
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}

export function browserPdf(binding: BrowserBinding): PdfRenderer {
  return {
    render: (job) => printed(binding, job).catch(() => null),
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

export function pdfRendererOf(env: Bindings): PdfRenderer | null {
  return env.BROWSER === undefined ? null : browserPdf(env.BROWSER);
}
