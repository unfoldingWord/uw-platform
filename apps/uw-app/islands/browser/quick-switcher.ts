import { pageIndexReplySchema, type PageIndexEntry } from '@uw/contracts';
import { createMatcher, type Matcher } from './switcher-match.ts';

export type SwitcherDeps = {
  readonly fetch: typeof fetch;
  readonly go: (href: string) => void;
  readonly openTab: (href: string) => void;
};

type Row = { readonly title: string; readonly meta: string; readonly href: string };

type Loaded = {
  readonly match: Matcher;
  readonly recent: readonly PageIndexEntry[];
  readonly failed: boolean;
};

type Parts = {
  readonly dialog: HTMLDialogElement;
  readonly input: HTMLInputElement;
  readonly list: HTMLElement;
  readonly status: HTMLElement | null;
  readonly template: HTMLTemplateElement;
};

const INDEX = '/api/pages/index';
const RECENT = '/api/pages/recent';
const SHOWN = 12;
const SELECTED = 'aria-selected';
const nothing: Loaded = { match: () => [], recent: [], failed: true };

function partsOf(document: Document): Parts | null {
  const dialog = document.querySelector<HTMLDialogElement>('[data-switcher]');
  if (dialog === null) return null;
  const input = dialog.querySelector<HTMLInputElement>('[data-switcher-input]');
  const list = dialog.querySelector<HTMLElement>('[data-switcher-list]');
  const template = dialog.querySelector<HTMLTemplateElement>('[data-switcher-row]');
  if (input === null || list === null || template === null) return null;
  const status = dialog.querySelector<HTMLElement>('[data-switcher-status]');
  return { dialog, input, list, status, template };
}

async function entriesFrom(send: typeof fetch, path: string): Promise<readonly PageIndexEntry[]> {
  const response = await send(path, { headers: { accept: 'application/json' } });
  return pageIndexReplySchema.parse(await response.json()).entries;
}

async function load(send: typeof fetch): Promise<Loaded> {
  try {
    const [index, recent] = await Promise.all([
      entriesFrom(send, INDEX),
      entriesFrom(send, RECENT),
    ]);
    return { match: createMatcher(index), recent, failed: false };
  } catch {
    return nothing;
  }
}

function pageRow(entry: PageIndexEntry): Row {
  return { title: entry.title, meta: entry.jdId ?? entry.jdArea, href: `/pages/${entry.id}` };
}

function searchRow(query: string): Row {
  return {
    title: `Search all text for “${query}”`,
    meta: '',
    href: `/search?q=${encodeURIComponent(query)}`,
  };
}

function createRow(query: string): Row {
  return {
    title: `Create page “${query}”`,
    meta: '',
    href: `/wiki/new?title=${encodeURIComponent(query)}`,
  };
}

function rowsFor(loaded: Loaded, query: string, here: string): readonly Row[] {
  const typed = query.trim();
  if (typed === '') {
    return loaded.recent.map(pageRow).filter((row) => row.href !== here);
  }
  return [...loaded.match(typed, SHOWN).map(pageRow), searchRow(typed), createRow(typed)];
}

function statusFor(loaded: Loaded | null, query: string, shown: number): string {
  if (loaded === null) return 'Loading pages';
  if (loaded.failed) return 'The page list could not be loaded.';
  if (query.trim() !== '') return '';
  return shown === 0 ? 'Type a page name or a JD ID' : 'Recently viewed';
}

function draw(parts: Parts, rows: readonly Row[], selected: number): void {
  const built = rows.map((row, index) => {
    const item = parts.template.content.firstElementChild?.cloneNode(true) as HTMLElement;
    item.id = `quick-switcher-row-${String(index)}`;
    item.setAttribute(SELECTED, index === selected ? 'true' : 'false');
    item.setAttribute('data-href', row.href);
    const title = item.querySelector('[data-title]');
    const meta = item.querySelector('[data-meta]');
    if (title !== null) title.textContent = row.title;
    if (meta !== null) meta.textContent = row.meta;
    return item;
  });
  parts.list.replaceChildren(...built);
  const active = built.at(selected);
  if (active === undefined) parts.input.removeAttribute('aria-activedescendant');
  else parts.input.setAttribute('aria-activedescendant', active.id);
}

function show(dialog: HTMLDialogElement): void {
  if (dialog.hasAttribute('open')) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function hide(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

function opens(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return false;
  const key = event.key.toLowerCase();
  if (key === 'o') return true;
  const target = event.target as Element | null;
  return key === 'k' && (target?.closest?.('[data-editor]') ?? null) === null;
}

function switcher(parts: Parts, document: Document, deps: SwitcherDeps) {
  let loaded: Loaded | null = null;
  let rows: readonly Row[] = [];
  let selected = 0;
  const here = () => document.location.pathname;
  const render = () => {
    rows = loaded === null ? [] : rowsFor(loaded, parts.input.value, here());
    selected = Math.min(selected, Math.max(rows.length - 1, 0));
    draw(parts, rows, selected);
    if (parts.status !== null) {
      parts.status.textContent = statusFor(loaded, parts.input.value, rows.length);
    }
  };
  const open = () => {
    show(parts.dialog);
    parts.input.value = '';
    selected = 0;
    render();
    parts.input.focus();
    void load(deps.fetch).then((fresh) => {
      loaded = fresh;
      render();
    });
  };
  const move = (by: number) => {
    if (rows.length === 0) return;
    selected = (selected + by + rows.length) % rows.length;
    draw(parts, rows, selected);
  };
  const choose = (index: number, newTab: boolean) => {
    const row = index < 0 ? undefined : rows.at(index);
    if (row === undefined) return;
    if (newTab) deps.openTab(row.href);
    else deps.go(row.href);
  };
  return {
    open,
    move,
    choose,
    retype: () => {
      selected = 0;
      render();
    },
    selected: () => selected,
    close: () => hide(parts.dialog),
  };
}

export function wireQuickSwitcher(document: Document, deps: SwitcherDeps): void {
  const parts = partsOf(document);
  if (parts === null) return;
  const state = switcher(parts, document, deps);
  document.addEventListener('keydown', (event) => {
    if (!opens(event)) return;
    event.preventDefault();
    state.open();
  });
  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    if (target?.closest?.('[data-open-switcher]')) state.open();
  });
  parts.input.addEventListener('input', state.retype);
  parts.input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      state.move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      state.choose(state.selected(), event.ctrlKey || event.metaKey);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      state.close();
    }
  });
  parts.dialog.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    if (target === parts.dialog) return state.close();
    const row = target?.closest?.('[role="option"]') ?? null;
    if (row === null) return;
    state.choose([...parts.list.children].indexOf(row), event.ctrlKey || event.metaKey);
  });
}
