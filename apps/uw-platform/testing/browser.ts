import type { BrowserBinding, PdfQuickAction, ScreenshotQuickAction } from '../env.ts';

const pdfBytes = new TextEncoder().encode('%PDF-1.7\n%test\n1 0 obj << >> endobj\n%%EOF\n');
const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function pngBytes(): Uint8Array {
  return Uint8Array.from(atob(pngBase64), (char) => char.charCodeAt(0));
}

export function fakeBrowser() {
  const calls: PdfQuickAction[] = [];
  const shots: ScreenshotQuickAction[] = [];
  async function quickAction(action: 'pdf', options: PdfQuickAction): Promise<Response>;
  async function quickAction(
    action: 'screenshot',
    options: ScreenshotQuickAction,
  ): Promise<Response>;
  async function quickAction(
    action: 'pdf' | 'screenshot',
    options: PdfQuickAction | ScreenshotQuickAction,
  ): Promise<Response> {
    if (action === 'screenshot' && 'viewport' in options) {
      shots.push(options);
      return new Response(Uint8Array.from(pngBytes()), {
        headers: { 'content-type': 'image/png' },
      });
    }
    if ('pdfOptions' in options) calls.push(options);
    return new Response(Uint8Array.from(pdfBytes), {
      headers: { 'content-type': 'application/pdf' },
    });
  }
  return { quickAction, calls: () => [...calls], screenshots: () => [...shots] };
}

export function failingBrowser(): BrowserBinding {
  return {
    quickAction: async (): Promise<Response> =>
      Response.json(
        { success: false, errors: [{ code: 500, message: 'render failed' }] },
        {
          status: 500,
        },
      ),
  };
}

export function browserDoingFirst(before: () => Promise<void>): BrowserBinding {
  const inner = fakeBrowser();
  async function quickAction(action: 'pdf', options: PdfQuickAction): Promise<Response>;
  async function quickAction(
    action: 'screenshot',
    options: ScreenshotQuickAction,
  ): Promise<Response>;
  async function quickAction(
    _action: 'pdf' | 'screenshot',
    options: PdfQuickAction | ScreenshotQuickAction,
  ): Promise<Response> {
    await before();
    if ('viewport' in options) return inner.quickAction('screenshot', options);
    return inner.quickAction('pdf', options);
  }
  return { quickAction };
}
