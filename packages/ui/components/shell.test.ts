import axe from 'axe-core';
import Color from 'colorjs.io';
import { jsx } from 'hono/jsx';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { resolveToken, themeTokens, type ThemeName } from '../../../tools/ui/css-tokens.ts';
import { PageHead } from './page-head.tsx';
import { Shell } from './shell.tsx';
import { THEME_KEY } from './theme-switch.tsx';

const nav = [
  { href: '/', label: 'Home' },
  { href: '/health', label: 'Health' },
];

async function render(overrides: Partial<Parameters<typeof Shell>[0]> = {}): Promise<string> {
  const props = {
    title: 'unfoldingWord',
    nav,
    current: '/',
    crumbs: [{ label: 'Home' }],
    stylesheet: '/assets/app-0123456789ab.css',
    children: jsx(PageHead, { title: 'unfoldingWord', lede: 'Your harnesses at a glance.' }),
    ...overrides,
  };
  return `<!DOCTYPE html>${await jsx(Shell, props).toString()}`;
}

function documentOf(html: string): Document {
  return new JSDOM(html).window.document;
}

describe('WB-11 the shell', () => {
  it('the shell renders one main landmark, a labelled navigation and a skip link', async () => {
    const html = await render();
    expect(html.match(/<main id="main"/g)).toHaveLength(1);
    expect(html.match(/<nav aria-label="Main"/g)).toHaveLength(1);
    expect(html).toContain('<a href="#main"');
    expect(html.indexOf('<a href="#main"')).toBeLessThan(html.indexOf('<nav aria-label="Main"'));
    expect(html).toContain('<header');
  });

  it('WB-11 the shell is fluid: no fixed page width, the sidebar collapses into a disclosure below the md breakpoint', async () => {
    const html = await render();
    expect(html).not.toMatch(/\b(?:min-|max-)?w-\[\d/);
    expect(html).not.toMatch(/\bw-\d{3,}/);
    const document = documentOf(html);
    const disclosure = document.querySelector('details');
    expect(disclosure?.querySelector('summary')?.textContent).toBe('Menu');
    expect(disclosure?.getAttribute('class')).toContain('md:hidden');
    expect(document.querySelectorAll('nav[aria-label="Main"]')).toHaveLength(1);
    expect(html).toContain('md:grid-cols-[var(--uw-sidebar)_1fr]');
  });

  it('the current page is marked aria-current="page"', async () => {
    const document = documentOf(await render({ current: '/health' }));
    const current = [...document.querySelectorAll('nav[aria-label="Main"] a[aria-current]')];
    expect(
      current.map((link) => [link.getAttribute('href'), link.getAttribute('aria-current')]),
    ).toEqual([['/health', 'page']]);
  });

  it('WB-11 the theme script reads the persisted choice before paint and sets data-theme', async () => {
    const html = await render();
    const head = html.slice(0, html.indexOf('</head>'));
    const script = head.indexOf('<script>');
    expect(script).toBeGreaterThan(-1);
    expect(script).toBeLessThan(head.indexOf('<link rel="stylesheet"'));
    const body = head.slice(script, head.indexOf('</script>'));
    expect(body).toContain(THEME_KEY);
    expect(body).toContain('dataset.theme');
    expect(html).toContain('<meta name="color-scheme" content="light dark"');
  });

  it('WB-12 copy says unfoldingWord in camelCase and has no exclamation marks', async () => {
    const document = documentOf(await render());
    for (const script of document.querySelectorAll('script')) script.remove();
    const text = document.body.textContent ?? '';
    expect(text).toContain('unfoldingWord');
    const spellings = new Set([...text.matchAll(/unfolding\s*word/gi)].map((match) => match[0]));
    expect([...spellings]).toEqual(['unfoldingWord']);
    expect(text).not.toContain('!');
  });
});

describe('the shell escapes the text it is given', () => {
  it('renders a title, nav label and crumb with markup as text, never as HTML', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const html = await render({
      title: hostile,
      nav: [{ href: '/', label: hostile }],
      crumbs: [{ label: hostile, href: '/x"onmouseover="alert(1)' }],
      children: jsx(PageHead, { title: hostile, eyebrow: hostile, lede: hostile }),
    });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('"onmouseover=');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('renders no link for a nav or crumb href that is not a relative path or https', async () => {
    const document = documentOf(
      await render({
        nav: [
          { href: 'javascript:alert(1)', label: 'Sneak' },
          { href: '/', label: 'Home' },
        ],
        crumbs: [{ label: 'Trail', href: 'data:text/html,x' }],
      }),
    );
    const hrefs = [...document.querySelectorAll('a[href]')].map((link) =>
      link.getAttribute('href'),
    );
    expect(hrefs).toEqual(['#main', '/']);
    expect(document.body.textContent).toContain('Trail');
  });
});

describe('the head theme script', () => {
  async function run(stored: string | null) {
    const dom = new JSDOM(await render(), {
      url: 'https://uw.example/',
      runScripts: 'outside-only',
    });
    const { window } = dom;
    if (stored !== null) window.localStorage.setItem(THEME_KEY, stored);
    const script = window.document.head.querySelector('script')?.textContent ?? '';
    window.eval(script);
    return window;
  }

  it('WB-11 sets data-theme from the persisted choice before the stylesheet loads', async () => {
    const window = await run('dark');
    expect(window.document.documentElement.dataset.theme).toBe('dark');
    window.close();
  });

  it('WB-11 leaves data-theme unset for a junk or missing value, so the system setting rules', async () => {
    for (const stored of ['purple', '<script>', null]) {
      const window = await run(stored);
      expect(window.document.documentElement.hasAttribute('data-theme')).toBe(false);
      window.close();
    }
  });
});

const themes: readonly ThemeName[] = ['light', 'dark'];

function contrast(theme: ThemeName, foreground: string, background: string): number {
  const tokens = themeTokens(theme);
  const ink = new Color(resolveToken(`--uw-${foreground}`, tokens));
  const ground = new Color(resolveToken(`--uw-${background}`, tokens));
  return ink.contrast(ground, 'WCAG21');
}

describe('focus is visible on every background the shell paints', () => {
  it.each(themes)(
    'in %s, the focus ring meets 3:1 against each shell background',
    async (theme) => {
      const html = await render();
      const grounds = [
        ...new Set([...html.matchAll(/\bbg-([a-z-]+)/g)].map((match) => match[1] ?? '')),
      ];
      expect(grounds).toEqual(expect.arrayContaining(['bg', 'ocean-panel', 'surface']));
      for (const ground of grounds)
        expect(contrast(theme, 'focus', ground)).toBeGreaterThanOrEqual(3);
    },
  );

  it('every link and control in the shell carries the focus ring', async () => {
    const document = documentOf(await render());
    const focusable = [...document.querySelectorAll('a, input, summary, button')];
    expect(focusable.length).toBeGreaterThan(5);
    for (const element of focusable) {
      const classes = element.getAttribute('class') ?? '';
      expect(classes).toContain('focus-visible:outline-2');
      expect(classes).toContain('outline-focus');
    }
  });
});

describe('the shell passes axe-core', () => {
  it('has no axe-core violations', async () => {
    const dom = new JSDOM(await render(), { runScripts: 'outside-only' });
    dom.window.eval(axe.source);
    const runner = (dom.window as unknown as { axe: typeof axe }).axe;
    const results = await runner.run(dom.window.document, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.passes.map((pass) => pass.id)).toEqual(
      expect.arrayContaining([
        'bypass',
        'label',
        'link-name',
        'region',
        'summary-name',
        'landmark-no-duplicate-main',
      ]),
    );
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    dom.window.close();
  });
});
