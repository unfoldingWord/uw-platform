import { jsx } from 'hono/jsx';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { appCss } from '../generated/app-css.ts';
import { testFrame } from '../testing/frame.ts';
import { PhoneHeader, Sidebar } from './sidebar.tsx';

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

async function frame(): Promise<Document> {
  const props = {
    sections: testFrame().sections,
    current: '/',
    person: testFrame().person,
    wordmarkPath: testFrame().wordmarkPath,
  };
  const desktop = await jsx(Sidebar, props).toString();
  const phone = await jsx(PhoneHeader, { ...props, title: 'Home', waiting: 2 }).toString();
  return new JSDOM(`<!DOCTYPE html><body>${desktop}${phone}</body>`).window.document;
}

function found(document: Document, selector: string): Element {
  const element = document.querySelector(selector);
  if (element === null) throw new Error(`no ${selector}`);
  return element;
}

describe('UI-5 the sidebar becomes a phone header below the md breakpoint', () => {
  it('UI-5 from the md breakpoint the sidebar is shown and the phone header is not', async () => {
    const document = await frame();
    expect(display(found(document, 'aside'), 'wide')).toBe('shown');
    expect(display(found(document, 'section[aria-label="Menu"]'), 'wide')).toBe('none');
  });

  it('UI-5 below the md breakpoint the sidebar is hidden and the phone header shows the mark, the page and the menu', async () => {
    const document = await frame();
    expect(display(found(document, 'aside'), 'narrow')).toBe('none');
    const phone = found(document, 'section[aria-label="Menu"]');
    expect(display(phone, 'narrow')).not.toBe('none');
    expect(phone.querySelector('img')?.getAttribute('alt')).toBe('unfoldingWord');
    expect(phone.textContent).toContain('Home');
    const menu = phone.querySelector('details');
    if (menu === null) throw new Error('no menu');
    expect(menu.querySelector('summary')?.textContent).toContain('Menu');
    expect(menu.hasAttribute('open')).toBe(false);
    expect(menu.querySelector('nav[aria-label="Main"] a[href="/health"]')).not.toBeNull();
  });

  it('reads the real generated rules', () => {
    expect(
      displayRules.some((rule) => rule.selector === '.md\\:flex' && rule.at.includes(wide)),
    ).toBe(true);
    expect(displayRules.some((rule) => rule.selector.startsWith('.hidden'))).toBe(true);
  });

  it('UI-5 an item without a page says Coming Soon and is not a link', async () => {
    const document = await frame();
    const ledger = [...document.querySelectorAll('aside [aria-disabled="true"]')].find((row) =>
      row.textContent?.includes('Ledger'),
    );
    expect(ledger?.textContent).toContain('Coming Soon');
    expect(ledger?.closest('a')).toBeNull();
    expect(document.querySelector('aside [data-area="30-39"]')?.textContent).toContain(
      'Infrastructure',
    );
  });
});
