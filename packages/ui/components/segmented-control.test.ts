import { jsx } from 'hono/jsx';
import { JSDOM, type DOMWindow } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { SegmentedControl } from './segmented-control.tsx';
import { THEME_KEY } from './inline-scripts.ts';
import { ThemeSwitch } from './theme-switch.tsx';

const choices = [
  { value: 'board', label: 'Board' },
  { value: 'list', label: 'List' },
  { value: 'gates', label: 'Gates' },
];

async function render(): Promise<Document> {
  const html = await jsx(SegmentedControl, {
    name: 'view',
    legend: 'View',
    choices,
    selected: 'list',
  }).toString();
  return new JSDOM(`<!DOCTYPE html><body>${html}</body>`).window.document;
}

describe('WB-11 the segmented control', () => {
  it('WB-11 a segmented control is a fieldset with a legend and one labelled radio per choice, the selected one checked', async () => {
    const document = await render();
    const fieldset = document.querySelector('fieldset');
    expect(fieldset?.querySelector('legend')?.textContent).toBe('View');
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(
      radios.map((radio) => [radio.name, radio.value, radio.closest('label')?.textContent]),
    ).toEqual([
      ['view', 'board', 'Board'],
      ['view', 'list', 'List'],
      ['view', 'gates', 'Gates'],
    ]);
    expect(radios.filter((radio) => radio.checked).map((radio) => radio.value)).toEqual(['list']);
  });

  it('every control has visible focus', async () => {
    const document = await render();
    for (const radio of document.querySelectorAll('input')) {
      const classes = radio.getAttribute('class') ?? '';
      expect(classes).toContain('focus-visible:outline-2');
      expect(classes).toContain('outline-focus');
    }
  });

  it('escapes its legend and labels', async () => {
    const html = await jsx(SegmentedControl, {
      name: 'x',
      legend: '<b>legend</b>',
      choices: [{ value: '"><b>', label: '<b>label</b>' }],
      selected: 'none',
    }).toString();
    expect(html).not.toContain('<b>');
  });
});

describe('WB-11 the theme switch', () => {
  async function load(stored: string | null) {
    const html = await jsx(ThemeSwitch, {}).toString();
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, {
      runScripts: 'outside-only',
      url: 'https://uw.example/',
    });
    const { window } = dom;
    if (stored !== null) window.localStorage.setItem(THEME_KEY, stored);
    for (const script of window.document.querySelectorAll('script'))
      window.eval(script.textContent);
    return window;
  }

  function choose(window: DOMWindow, value: string): void {
    const radio = window.document.querySelector<HTMLInputElement>(`input[value="${value}"]`);
    if (radio === null) throw new Error(`no ${value} radio`);
    radio.checked = true;
    radio.dispatchEvent(new window.Event('change', { bubbles: true }));
  }

  it('WB-11 offers System, Light and Dark, with System checked when nothing is stored', async () => {
    const window = await load(null);
    const radios = [...window.document.querySelectorAll<HTMLInputElement>('input[name="theme"]')];
    expect(radios.map((radio) => radio.value)).toEqual(['system', 'light', 'dark']);
    expect(radios.find((radio) => radio.checked)?.value).toBe('system');
    expect(window.document.querySelector('legend')?.textContent).toBe('Colour theme');
    window.close();
  });

  it('WB-11 checks the persisted choice on load', async () => {
    const window = await load('dark');
    expect(window.document.querySelector<HTMLInputElement>('input[value="dark"]')?.checked).toBe(
      true,
    );
    window.close();
  });

  it('WB-11 a choice sets data-theme and persists it; System removes both so the system setting rules', async () => {
    const window = await load(null);
    choose(window, 'dark');
    expect(window.document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_KEY)).toBe('dark');
    choose(window, 'system');
    expect(window.document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull();
    window.close();
  });
});
