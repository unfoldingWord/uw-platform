import { jsx } from 'hono/jsx';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { appCss } from '../generated/app-css.ts';
import { Sidebar } from './sidebar.tsx';

type Rule = { readonly at: readonly string[]; readonly selector: string; readonly body: string };

const wide = '@media (min-width:48rem)';

function cssRules(css: string): Rule[] {
  const rules: Rule[] = [];
  const open: string[] = [];
  let buffer = '';
  for (const character of css) {
    if (character === '{') {
      open.push(buffer.trim());
      buffer = '';
    } else if (character === '}') {
      const prelude = open.pop() ?? '';
      if (buffer.trim() !== '')
        rules.push({ at: open.filter((p) => p.startsWith('@')), selector: prelude, body: buffer });
      buffer = '';
    } else buffer += character;
  }
  return rules;
}

const displayRules = cssRules(appCss).filter(
  (rule) =>
    /display:(?:flex|none)/.test(rule.body) &&
    rule.at.every((at) => at.startsWith('@layer') || at === wide),
);

function matches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

function display(element: Element, atWidth: 'narrow' | 'wide'): string {
  const applying = displayRules.filter(
    (rule) => (atWidth === 'wide' || !rule.at.includes(wide)) && matches(element, rule.selector),
  );
  const last = applying.at(-1);
  if (last === undefined) return 'default';
  return /display:none/.test(last.body) ? 'none' : 'shown';
}

async function sidebar(): Promise<Document> {
  const html = await jsx(Sidebar, {
    items: [{ href: '/', label: 'Home' }],
    current: '/',
  }).toString();
  return new JSDOM(`<!DOCTYPE html><body>${html}</body>`).window.document;
}

function navList(document: Document): Element {
  const list = document.querySelector('nav[aria-label="Main"] ul');
  if (list === null) throw new Error('no main navigation list');
  return list;
}

describe('WB-11 the sidebar navigation at each width', () => {
  it('WB-11 from the md breakpoint the main navigation links are shown by a generated rule and sit in no closed disclosure', async () => {
    const document = await sidebar();
    const links = navList(document);
    expect(links.closest('details:not([open])')).toBeNull();
    expect(display(links, 'wide')).toBe('shown');
    const summary = document.querySelector('summary');
    expect(summary === null ? 'none' : display(summary.closest('details') ?? summary, 'wide')).toBe(
      'none',
    );
  });

  it('WB-11 below the md breakpoint the main navigation links are hidden until the Menu disclosure opens', async () => {
    const document = await sidebar();
    const links = navList(document);
    const disclosure = document.querySelector('details');
    expect(disclosure?.querySelector('summary')?.textContent).toBe('Menu');
    expect(display(links, 'narrow')).toBe('none');
    disclosure?.setAttribute('open', '');
    expect(display(links, 'narrow')).toBe('shown');
  });

  it('reads the real generated rules', () => {
    expect(
      displayRules.some((rule) => rule.selector === '.md\\:flex' && rule.at.includes(wide)),
    ).toBe(true);
    expect(displayRules.some((rule) => rule.selector.startsWith('.hidden'))).toBe(true);
  });
});
