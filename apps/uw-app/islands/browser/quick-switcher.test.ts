import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { wireQuickSwitcher } from './quick-switcher.ts';

const markup = `
  <button data-open-switcher>Jump</button>
  <textarea data-editor></textarea>
  <dialog data-switcher>
    <input data-switcher-input role="combobox" />
    <p data-switcher-status></p>
    <ul data-switcher-list role="listbox"></ul>
    <template data-switcher-row>
      <li role="option" aria-selected="false"><span data-title></span><span data-meta></span></li>
    </template>
  </dialog>`;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const entry = (n: number, title: string, jdId: string | null = null) => ({
  id: id(n),
  title,
  type: 'knowledge',
  jdArea: '00-09',
  jdId,
  aliases: [],
});

const index = {
  entries: [
    entry(1, '01.47 Security Guidelines', '01.47'),
    entry(2, '01.26 Budgeting', '01.26'),
    entry(3, 'Innovation'),
  ],
};
const recent = { entries: [entry(3, 'Innovation'), entry(2, '01.26 Budgeting', '01.26')] };

type Rig = {
  readonly dom: JSDOM;
  readonly went: string[];
  readonly opened: string[];
  readonly fetched: string[];
};

function rig(path = '/wiki', fail = false): Rig {
  const dom = new JSDOM(`<!DOCTYPE html><body>${markup}</body>`, {
    url: `https://uw.example${path}`,
  });
  const went: string[] = [];
  const opened: string[] = [];
  const fetched: string[] = [];
  const send = (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    fetched.push(url);
    if (fail) return Promise.reject(new Error('offline'));
    return Promise.resolve(Response.json(url.endsWith('/recent') ? recent : index));
  };
  wireQuickSwitcher(dom.window.document, {
    fetch: send,
    go: (href) => went.push(href),
    openTab: (href) => opened.push(href),
  });
  return { dom, went, opened, fetched };
}

function press(made: Rig, key: string, init: KeyboardEventInit = {}, on = 'body'): KeyboardEvent {
  const { window } = made.dom;
  const event = new window.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  window.document.querySelector(on)?.dispatchEvent(event);
  return event;
}

async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function type(made: Rig, text: string): void {
  const input = made.dom.window.document.querySelector<HTMLInputElement>('[data-switcher-input]');
  if (input === null) throw new Error('no input');
  input.value = text;
  input.dispatchEvent(new made.dom.window.Event('input', { bubbles: true }));
}

function rows(made: Rig): string[] {
  return [...made.dom.window.document.querySelectorAll('[data-switcher-list] [role="option"]')].map(
    (row) => `${row.getAttribute('aria-selected') === 'true' ? '>' : ' '}${row.textContent ?? ''}`,
  );
}

const isOpen = (made: Rig) =>
  made.dom.window.document.querySelector('[data-switcher]')?.hasAttribute('open') === true;

describe('#175 the Quick Switcher opens from the keyboard and from its button', () => {
  it('opens on Ctrl+O and on Cmd+O, taking the key from the browser', async () => {
    const made = rig();
    const control = press(made, 'o', { ctrlKey: true });
    expect(control.defaultPrevented).toBe(true);
    expect(isOpen(made)).toBe(true);
    press(made, 'Escape', {}, '[data-switcher-input]');
    expect(isOpen(made)).toBe(false);
    expect(press(made, 'O', { metaKey: true }).defaultPrevented).toBe(true);
    expect(isOpen(made)).toBe(true);
    await settled();
  });

  it('opens on Ctrl+K too, but leaves Ctrl+K to the editor when the editor has the key', () => {
    const made = rig();
    expect(press(made, 'k', { ctrlKey: true }, '[data-editor]').defaultPrevented).toBe(false);
    expect(isOpen(made)).toBe(false);
    expect(press(made, 'o', { ctrlKey: true }, '[data-editor]').defaultPrevented).toBe(true);
    expect(isOpen(made)).toBe(true);
    const other = rig();
    press(other, 'k', { metaKey: true });
    expect(isOpen(other)).toBe(true);
  });

  it('leaves a plain o, and Ctrl+Shift+O, alone', () => {
    const made = rig();
    expect(press(made, 'o').defaultPrevented).toBe(false);
    expect(press(made, 'o', { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(isOpen(made)).toBe(false);
  });

  it('opens from its button, for a phone with no keyboard', () => {
    const made = rig();
    made.dom.window.document.querySelector<HTMLElement>('[data-open-switcher]')?.click();
    expect(isOpen(made)).toBe(true);
  });
});

describe('#175 the Quick Switcher lists recent pages, then matches as you type', () => {
  it('shows the pages you viewed last, newest first, without the one you are on', async () => {
    const made = rig(`/pages/${id(3)}`);
    press(made, 'o', { ctrlKey: true });
    await settled();
    expect(made.fetched.sort()).toEqual(['/api/pages/index', '/api/pages/recent']);
    expect(rows(made)).toEqual(['>01.26 Budgeting01.26']);
    press(made, 'Enter', {}, '[data-switcher-input]');
    expect(made.went).toEqual([`/pages/${id(2)}`]);
  });

  it('matches titles and JD IDs, and offers a full-text search as the last row', async () => {
    const made = rig();
    press(made, 'o', { ctrlKey: true });
    await settled();
    type(made, 'secur');
    expect(rows(made)).toEqual(['>01.47 Security Guidelines01.47', ' Search all text for “secur”']);
    type(made, '0126');
    expect(rows(made)[0]).toBe('>01.26 Budgeting01.26');
    type(made, 'nothing like this');
    expect(rows(made)).toEqual(['>Search all text for “nothing like this”']);
    press(made, 'Enter', {}, '[data-switcher-input]');
    expect(made.went).toEqual(['/search?q=nothing%20like%20this']);
  });
});

describe('#175 the Quick Switcher is driven from the keyboard', () => {
  it('moves with the arrows, opens with Enter, and opens a new tab with Ctrl or Cmd and Enter', async () => {
    const made = rig();
    press(made, 'o', { ctrlKey: true });
    await settled();
    type(made, '01');
    expect(rows(made).filter((row) => row.startsWith('>'))).toHaveLength(1);
    const first = rows(made)[0];
    press(made, 'ArrowDown', {}, '[data-switcher-input]');
    expect(rows(made)[0]).toBe(first?.replace('>', ' '));
    expect(rows(made)[1]?.startsWith('>')).toBe(true);
    press(made, 'ArrowUp', {}, '[data-switcher-input]');
    press(made, 'ArrowUp', {}, '[data-switcher-input]');
    expect(rows(made).at(-1)?.startsWith('>')).toBe(true);
    press(made, 'ArrowDown', {}, '[data-switcher-input]');
    press(made, 'Enter', { metaKey: true }, '[data-switcher-input]');
    expect(made.opened).toHaveLength(1);
    expect(made.went).toEqual([]);
    expect(isOpen(made)).toBe(true);
  });

  it('says so in place when the page list cannot be loaded, and still offers search', async () => {
    const made = rig('/wiki', true);
    press(made, 'o', { ctrlKey: true });
    await settled();
    const status = made.dom.window.document.querySelector('[data-switcher-status]');
    expect(status?.textContent).toBe('The page list could not be loaded.');
    type(made, 'budget');
    expect(rows(made)).toEqual(['>Search all text for “budget”']);
  });
});
