import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { appCss, printColours, printMetrics } from '../../packages/ui/generated/app-css.ts';
import {
  blockAt,
  cssBlocks,
  resolveToken,
  themeContexts,
  themeTokens,
  tokenFile,
} from './css-tokens.ts';

const printCss = (): string => readFileSync('packages/ui/print.css', 'utf8');
const forcedLight = "@media print :root, :root[data-theme='dark'], :root:not([data-theme='light'])";

function printRules(): Map<string, Map<string, string>> {
  return new Map(cssBlocks(printCss()).map((block) => [block.context, block.declarations]));
}

function ruleFor(selector: string): Map<string, string> | undefined {
  return printRules().get(`@media print ${selector}`);
}

describe('#198 print styles come from the tokens', () => {
  it('#198 printMetrics are the print tokens of layout.css resolved at build', () => {
    const layout = blockAt(tokenFile('layout'), ':root');
    const token = (name: string): string => resolveToken(name, layout);
    expect(printMetrics).toEqual({
      paper: token('--uw-print-paper'),
      margin: {
        top: token('--uw-print-margin-top'),
        bottom: token('--uw-print-margin-bottom'),
        left: token('--uw-print-margin-left'),
        right: token('--uw-print-margin-right'),
      },
      headerFontSize: token('--uw-print-header-text'),
      footerFontSize: token('--uw-print-footer-text'),
      markHeight: token('--uw-print-mark-height'),
    });
    expect(token('--uw-print-paper')).toBe('letter');
  });

  it('#198 printColours are light theme roles resolved to hex at build', () => {
    const light = themeTokens('light');
    const colours = {
      ink: resolveToken('--uw-text', light),
      muted: resolveToken('--uw-text-3', light),
      line: resolveToken('--uw-line', light),
      accent: resolveToken('--uw-accent-text', light),
    };
    expect(printColours).toEqual(colours);
    expect(Object.values(colours).every((value) => /^#[0-9a-f]{6}$/i.test(value))).toBe(true);
  });

  it('#198 print forces every light role over both dark contexts so dark never prints', () => {
    const light = blockAt(tokenFile('theme'), themeContexts.light);
    expect(blockAt(tokenFile('print-theme'), forcedLight)).toEqual(light);
    expect(printCss().startsWith("@import './tokens/print-theme.css';")).toBe(true);
  });
});

describe('#198 the print stylesheet lays out a PDF', () => {
  it('#198 print hides controls, forms, buttons and anything marked data-pdf-hidden', () => {
    const hidden = [...printRules()].find(([context]) => context.includes('[data-pdf-hidden]'));
    const selectors = hidden?.[0] ?? '';
    for (const part of ['[data-side]', '[data-chrome]', '[data-print]', 'form', 'button', 'dialog'])
      expect(selectors).toContain(part);
    expect(hidden?.[1].get('display')).toBe('none');
  });

  it('#198 printed tables are real tables whose header row repeats on every page', () => {
    expect(ruleFor('table')?.get('display')).toBe('table');
    expect(ruleFor('thead')?.get('display')).toBe('table-header-group');
  });

  it('#198 rows, cards, figures and charts never split across a page', () => {
    const avoid = [...printRules()].find(([, rule]) => rule.get('break-inside') === 'avoid');
    for (const part of ['tr', '[data-card]', 'figure', 'svg']) expect(avoid?.[0]).toContain(part);
  });

  it('#198 every binder section starts a new page after the cover and contents', () => {
    expect(ruleFor('[data-pdf-section]')?.get('break-before')).toBe('page');
    expect(ruleFor('[data-pdf-cover]')?.get('break-after')).toBe('page');
    expect(ruleFor('[data-pdf-contents]')?.get('break-after')).toBe('page');
  });

  it('#198 footnote markers and the closing links and provenance blocks are styled', () => {
    expect(ruleFor('sup[data-footnote]')).toBeDefined();
    expect(ruleFor('[data-pdf-links]')).toBeDefined();
    expect(ruleFor('[data-pdf-provenance]')).toBeDefined();
  });

  it('#198 the app stylesheet carries the print stylesheet after the page body styles', () => {
    const app = readFileSync('packages/ui/app.css', 'utf8');
    expect(app.indexOf("@import './print.css';")).toBeGreaterThan(
      app.indexOf("@import './page-body.css';"),
    );
    expect(appCss).toContain('[data-pdf-hidden]');
  });
});
