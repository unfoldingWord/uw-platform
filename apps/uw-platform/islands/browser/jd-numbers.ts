import {
  areaOfCategory,
  jdCategorySchema,
  jdIdOfTitle,
  nextFreeJdId,
  titleWithJdId,
} from '@uw/contracts';

type JdNumbersDeps = { readonly fetch: typeof fetch };

type Entry = { readonly id: string; readonly title: string; readonly jdId: string | null };

type Parts = {
  readonly title: HTMLInputElement;
  readonly category: HTMLInputElement | null;
  readonly fixed: string | null;
  readonly status: HTMLElement;
  readonly use: HTMLButtonElement;
  readonly list: HTMLUListElement;
  readonly row: HTMLTemplateElement;
};

const INDEX = '/api/pages/index';
const SHOWN = 6;
const LEADING_NUMBER = /^[0-9]{2}\.?[0-9]{0,2}/;
const LEADING_CATEGORY = /^\s*([0-9]{2})(?=\.|\s|$)/;

function numberOf(entry: Entry): string | null {
  return entry.jdId ?? jdIdOfTitle(entry.title);
}

function entriesOf(body: unknown): readonly Entry[] {
  if (typeof body !== 'object' || body === null || !('entries' in body)) return [];
  const { entries } = body;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) return [];
    const entry = raw as Record<string, unknown>;
    const { id, title, jdId } = entry;
    if (typeof id !== 'string' || typeof title !== 'string') return [];
    return [{ id, title, jdId: typeof jdId === 'string' ? jdId : null }];
  });
}

async function loadIndex(deps: JdNumbersDeps): Promise<readonly Entry[]> {
  try {
    const response = await deps.fetch(INDEX, { headers: { accept: 'application/json' } });
    return response.ok ? entriesOf(await response.json()) : [];
  } catch {
    return [];
  }
}

function matchesFor(entries: readonly Entry[], text: string): readonly Entry[] {
  const typed = text.trim();
  if (typed.length < 2) return [];
  const lead = LEADING_NUMBER.exec(typed);
  if (lead !== null) {
    const prefix = lead[0];
    const found = entries.filter((entry) => numberOf(entry)?.startsWith(prefix) === true);
    return [...found]
      .sort((a, b) => (numberOf(a) ?? '').localeCompare(numberOf(b) ?? ''))
      .slice(0, SHOWN);
  }
  const lower = typed.toLowerCase();
  return entries.filter((entry) => entry.title.toLowerCase().includes(lower)).slice(0, SHOWN);
}

function takenIn(entries: readonly Entry[], category: string): readonly string[] {
  return entries.flatMap((entry) => {
    const number = numberOf(entry);
    return number?.startsWith(`${category}.`) === true ? [number] : [];
  });
}

function showMatches(parts: Parts, matches: readonly Entry[]): void {
  parts.list.replaceChildren();
  for (const entry of matches) {
    const row = parts.row.content.cloneNode(true) as DocumentFragment;
    row.querySelector('a')?.setAttribute('href', `/pages/${encodeURIComponent(entry.id)}`);
    const number = row.querySelector('[data-number]');
    if (number !== null)
      number.textContent = jdIdOfTitle(entry.title) === null ? (numberOf(entry) ?? '') : '';
    const title = row.querySelector('[data-title]');
    if (title !== null) title.textContent = entry.title;
    parts.list.append(row);
  }
  parts.list.hidden = matches.length === 0;
}

function showNumber(parts: Parts, entries: readonly Entry[]): void {
  const number = jdIdOfTitle(parts.title.value);
  parts.use.hidden = true;
  if (number === null) {
    parts.status.textContent = '';
    return;
  }
  const category = number.slice(0, 2);
  const move = moveNote(parts.fixed, category);
  const holder = entries.find((entry) => numberOf(entry) === number);
  if (holder === undefined) {
    parts.status.textContent = `${number} is free.${move}`;
    return;
  }
  parts.status.textContent = `${number} is already used by ${holder.title}.${move}`;
  offerNext(parts, entries, category);
}

function moveNote(fixed: string | null, category: string): string {
  if (fixed === null || fixed === category) return '';
  const area = areaOfCategory(category);
  const across = area === areaOfCategory(fixed) ? '' : `, in area ${area}`;
  return ` Saving moves this page to category ${category}${across}.`;
}

function offerNext(parts: Parts, entries: readonly Entry[], category: string): void {
  const next = nextFreeJdId(category, takenIn(entries, category));
  if (next === null) return;
  parts.use.textContent = `Use ${next}`;
  parts.use.dataset['next'] = next;
  parts.use.hidden = false;
}

function categoryFromTitle(parts: Parts): void {
  const category = LEADING_CATEGORY.exec(parts.title.value)?.[1];
  if (parts.category === null || category === undefined) return;
  if (parts.category.value.trim() !== category) parts.category.value = category;
}

function titleFromCategory(parts: Parts, entries: readonly Entry[]): void {
  const category = jdCategorySchema.safeParse(parts.category?.value.trim());
  if (!category.success) return;
  if (jdIdOfTitle(parts.title.value)?.startsWith(`${category.data}.`) === true) return;
  const next = nextFreeJdId(category.data, takenIn(entries, category.data));
  if (next !== null) parts.title.value = titleWithJdId(parts.title.value, next);
}

function partsOf(form: HTMLFormElement): Parts | null {
  const title = form.querySelector<HTMLInputElement>('input[name="title"]');
  const category = form.querySelector<HTMLInputElement>('input[name="category"]');
  const status = form.querySelector<HTMLElement>('[data-jd-status]');
  const use = form.querySelector<HTMLButtonElement>('[data-jd-use]');
  const list = form.querySelector<HTMLUListElement>('[data-jd-matches]');
  const row = form.querySelector<HTMLTemplateElement>('template[data-jd-row]');
  if (title === null || status === null) return null;
  if (use === null || list === null || row === null) return null;
  const fixed = form.getAttribute('data-jd-category');
  return { title, category, fixed, status, use, list, row };
}

export function wireJdNumbers(document: Document, deps: JdNumbersDeps): void {
  const form = document.querySelector<HTMLFormElement>('form[data-jd-numbered]');
  const parts = form === null ? null : partsOf(form);
  if (parts === null) return;
  const self = form?.getAttribute('data-page-id') ?? null;
  let entries: readonly Entry[] = [];
  const refresh = () => {
    showMatches(parts, matchesFor(entries, parts.title.value));
    showNumber(parts, entries);
  };
  parts.title.addEventListener('input', () => {
    categoryFromTitle(parts);
    refresh();
  });
  parts.category?.addEventListener('input', () => {
    titleFromCategory(parts, entries);
    refresh();
  });
  parts.use.addEventListener('click', () => {
    const next = parts.use.dataset['next'];
    if (next === undefined) return;
    parts.title.value = titleWithJdId(parts.title.value, next);
    categoryFromTitle(parts);
    refresh();
    parts.title.focus();
  });
  void loadIndex(deps).then((loaded) => {
    entries = loaded.filter((entry) => entry.id !== self);
    if (parts.title.value.trim() !== '') refresh();
  });
}
