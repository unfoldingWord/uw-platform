import { describe, expect, it } from 'vitest';
import type { PdfQuickAction } from '../env.ts';
import { failingBrowser, fakeBrowser } from './browser.ts';

const job: PdfQuickAction = {
  html: '<!doctype html><title>t</title><p>x</p>',
  pdfOptions: {
    format: 'letter',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<span class="title"></span>',
    footerTemplate: '<span class="pageNumber"></span>',
    margin: { top: 'a', bottom: 'b', left: 'c', right: 'd' },
    outline: true,
    tagged: true,
  },
  emulateMediaType: 'print',
  setJavaScriptEnabled: false,
  allowRequestPattern: ['^data:'],
  cacheTTL: 0,
};

describe('#198 the test browser stands in for the Browser Run binding', () => {
  it('#198 the fake browser answers a PDF and records every quick action it was given', async () => {
    const browser = fakeBrowser();
    const response = await browser.quickAction('pdf', job);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect((await response.text()).startsWith('%PDF-1.7\n')).toBe(true);
    expect(browser.calls()).toEqual([job]);
  });

  it('#198 the failing browser answers a server error and no PDF', async () => {
    const response = await failingBrowser().quickAction('pdf', job);
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).not.toBe('application/pdf');
  });
});
