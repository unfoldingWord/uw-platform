import { printColours, printMetrics } from '@uw/ui/generated/app-css';
import { markBase64 } from '@uw/ui/generated/mark';
import type { Provenance } from './provenance.ts';

const SHORT_HASH = 12;

const escapes: ReadonlyMap<string, string> = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]);

function escapedHtml(words: string): string {
  return words.replace(/[&<>"']/g, (found) => escapes.get(found) ?? found);
}

function shortProvenance(provenance: Provenance): string {
  const hash = provenance.sourceSha256.slice(0, SHORT_HASH);
  return `${provenance.reference} · ${provenance.exportedOn} · source sha256:${hash}`;
}

function band(fontSize: string, colour: string, justify: string): string {
  const { left, right } = printMetrics.margin;
  return [
    'width:100%',
    'box-sizing:border-box',
    `padding:0 ${right} 0 ${left}`,
    `font-size:${fontSize}`,
    `color:${colour}`,
    'font-family:sans-serif',
    'display:flex',
    'align-items:center',
    `justify-content:${justify}`,
    '-webkit-print-color-adjust:exact',
  ].join(';');
}

export function headerTemplate(title: string): string {
  const style = band(printMetrics.headerFontSize, printColours.ink, 'flex-start');
  const mark = `<img src="data:image/png;base64,${markBase64}" alt="" style="height:${printMetrics.markHeight}">`;
  return `<div style="${style}">${mark}<span>&ensp;${escapedHtml(title)}</span></div>`;
}

export function footerTemplate(provenance: Provenance): string {
  const style = band(printMetrics.footerFontSize, printColours.muted, 'space-between');
  const line = `<span>${escapedHtml(shortProvenance(provenance))}</span>`;
  const count = 'Page <span class="pageNumber"></span> of <span class="totalPages"></span>';
  return `<div style="${style}">${line}<span>${count}</span></div>`;
}
