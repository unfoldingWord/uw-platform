import type { BrowserBinding, PdfQuickAction } from '../env.ts';

const pdfBytes = new TextEncoder().encode('%PDF-1.7\n%test\n1 0 obj << >> endobj\n%%EOF\n');

export function fakeBrowser(): BrowserBinding & {
  readonly calls: () => readonly PdfQuickAction[];
} {
  const calls: PdfQuickAction[] = [];
  return {
    quickAction: async (_action, options) => {
      calls.push(options);
      return new Response(Uint8Array.from(pdfBytes), {
        headers: { 'content-type': 'application/pdf' },
      });
    },
    calls: () => [...calls],
  };
}

export function failingBrowser(): BrowserBinding {
  return {
    quickAction: async () =>
      Response.json(
        { success: false, errors: [{ code: 500, message: 'render failed' }] },
        {
          status: 500,
        },
      ),
  };
}
