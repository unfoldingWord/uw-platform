import { jsx } from 'hono/jsx';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { appCss } from '../generated/app-css.ts';
import { testFrame } from '../testing/frame.ts';
import { speculationRules } from './inline-scripts.ts';
import { PhoneHeader, Sidebar, type NavSection } from './sidebar.tsx';

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

const plainRules = cssRules(appCss).filter((rule) =>
  rule.at.every((at) => at.startsWith('@layer')),
);

function declared(element: Element, property: string): string | undefined {
  let value: string | undefined;
  for (const rule of plainRules) {
    if (!matches(element, rule.selector)) continue;
    for (const declaration of rule.body.split(';')) {
      const [name, ...rest] = declaration.split(':');
      if (name?.trim() === property) value = rest.join(':').trim();
    }
  }
  return value;
}

const spacingSteps = new Map(
  [...appCss.matchAll(/(--uw-space-\d):(\d+)px/g)].map((found) => [found[1], Number(found[2])]),
);

function pixels(value: string | undefined): number {
  const token = /var\((--uw-space-\d)\)/.exec(value ?? '')?.[1];
  const size = spacingSteps.get(token);
  if (size === undefined) throw new Error(`not a spacing token: ${String(value)}`);
  return size;
}

function sidePadding(element: Element): number {
  return pixels(declared(element, 'padding-inline') ?? declared(element, 'padding'));
}

const longArea: readonly NavSection[] = [
  { heading: 'unfoldingWord Home', code: '00-09', items: [{ label: 'Today', href: '/' }] },
  {
    heading: 'Internal Operations & Administration',
    code: '10-19',
    items: [{ label: 'Directory & Access' }],
  },
];

async function frame(sections: readonly NavSection[] = testFrame().sections): Promise<Document> {
  const props = {
    sections,
    current: '/',
    person: testFrame().person,
    logOut: testFrame().logOut,
    wordmarkPath: testFrame().wordmarkPath,
  };
  const desktop = await jsx(Sidebar, props).toString();
  const phone = await jsx(PhoneHeader, { ...props, title: 'Home', waiting: 2 }).toString();
  return new JSDOM(`<!DOCTYPE html><body>${desktop}${phone}</body>`).window.document;
}

function found(document: Document | Element, selector: string): Element {
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

  it('UI-5 an item without a page is dimmed, carries no pill and is not a link', async () => {
    const document = await frame();
    const ledger = [...document.querySelectorAll('aside [aria-disabled="true"]')].find((row) =>
      row.textContent?.includes('Ledger'),
    );
    expect(ledger?.getAttribute('class')).toContain('opacity-45');
    expect(ledger?.textContent).not.toMatch(/Coming Soon|Future/);
    expect(ledger?.closest('a')).toBeNull();
    expect(document.querySelector('aside [data-area="30-39"]')?.textContent).toContain(
      'Infrastructure',
    );
  });
});

describe('#143 the sidebar keeps to the spacing scale and groups read as groups', () => {
  it('#143 a long area heading keeps its number whole, on the first line of the heading', async () => {
    const document = await frame(longArea);
    for (const menu of ['aside', 'section[aria-label="Menu"]']) {
      const heading = found(document, `${menu} [data-area="10-19"]`);
      const number = found(document, `${menu} [data-area="10-19"] span`);
      expect(number.textContent).toBe('10-19');
      expect(declared(number, 'white-space')).toBe('nowrap');
      expect(declared(number, 'flex-shrink')).toBe('0');
      expect(declared(heading, 'align-items')).toBe('baseline');
    }
  });

  it('#143 groups sit further apart than a heading sits from its own rows', async () => {
    const document = await frame(longArea);
    for (const menu of ['aside', 'section[aria-label="Menu"]']) {
      const groups = found(document, `${menu} nav > ul`);
      const heading = found(document, `${menu} [data-area="10-19"]`);
      const between = pixels(declared(groups, 'gap'));
      expect(between).toBeGreaterThan(pixels(declared(heading, 'padding-bottom')));
      expect(declared(heading, 'padding-top')).toBeUndefined();
      expect(declared(found(document, `${menu} nav > ul ul`), 'gap')).toBeUndefined();
    }
  });

  it('#143 headings and rows start level with the logo above and the name below', async () => {
    const document = await frame(longArea);
    const nav = sidePadding(found(document, 'aside nav'));
    const edge = sidePadding(found(document, 'aside > div:first-child'));
    expect(nav + sidePadding(found(document, 'aside [data-area="10-19"]'))).toBe(edge);
    expect(nav + sidePadding(found(document, 'aside nav a'))).toBe(edge);
    expect(sidePadding(found(document, 'aside > div:nth-last-child(2)'))).toBe(edge);
    const foot = found(document, 'aside > div:last-child');
    expect(sidePadding(foot) + sidePadding(found(foot, 'a'))).toBe(edge);
    const phoneNav = sidePadding(found(document, 'section[aria-label="Menu"] nav'));
    const phoneEdge = sidePadding(found(document, 'section[aria-label="Menu"] summary'));
    expect(phoneNav + sidePadding(found(document, 'section[aria-label="Menu"] nav a'))).toBe(
      phoneEdge,
    );
  });
});

type Rules = {
  readonly prefetch: readonly { readonly where: { readonly and: readonly unknown[] } }[];
};

function leftAlone(path: string): boolean {
  const rules = JSON.parse(speculationRules) as Rules;
  const patterns = rules.prefetch.flatMap((rule) =>
    rule.where.and.flatMap((clause) => {
      const pattern = (clause as { not?: { href_matches?: string } }).not?.href_matches;
      return pattern === undefined ? [] : [pattern];
    }),
  );
  return patterns.some((pattern) =>
    pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern,
  );
}

const logoutPath = testFrame().logOut.href;

function logOutLinks(scope: Element): Element[] {
  return [...scope.querySelectorAll(`a[href="${logoutPath}"]`)];
}

describe('#149 a person can log out', () => {
  it('#149 the sidebar and the phone menu each carry one Log Out link to the Access logout', async () => {
    const document = await frame();
    for (const scope of [found(document, 'aside'), found(document, 'section[aria-label="Menu"]')]) {
      const links = logOutLinks(scope);
      expect(links).toHaveLength(1);
      expect(links[0]?.textContent).toBe('Log Out');
    }
  });

  it('#149 the sidebar offers Log Out even with no person shown', async () => {
    const html = await jsx(Sidebar, { ...testFrame(), current: '/', person: null }).toString();
    const document = new JSDOM(`<!DOCTYPE html><body>${html}</body>`).window.document;
    expect(logOutLinks(found(document, 'aside'))).toHaveLength(1);
  });

  it('#149 hover prefetch leaves the logout address alone', () => {
    expect(leftAlone(logoutPath)).toBe(true);
    expect(leftAlone('/health')).toBe(false);
  });
});
