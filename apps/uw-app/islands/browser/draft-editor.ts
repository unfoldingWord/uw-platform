import { draftCheckSchema, type DraftProblem, type DraftStage } from '@uw/contracts';
import { reasonText } from '@uw/ui/components/text.ts';
import { redrawMap, wireDraftMap, type HitTest } from './draft-map.ts';

export const DRAFT_CHECK_MS = 2000;

const cleanCheck = '✓ Checked: every path reaches an end, and a person approves before any merge.';
const problemStyle =
  'rounded-md border border-line-strong bg-raised px-3 py-1 text-sm font-semibold text-text';

export type DraftTimers = {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type DraftDeps = {
  readonly fetch: typeof fetch;
  readonly uuid: () => string;
  readonly timers: DraftTimers;
  readonly hitTest?: HitTest;
};

type Control = HTMLInputElement | HTMLSelectElement;

function valueOf(row: Element, name: string): string {
  return row.querySelector<Control>(`[name="${name}"]`)?.value ?? '';
}

function stageOf(row: HTMLElement): DraftStage {
  const data = row.dataset;
  const loops = [...row.querySelectorAll<HTMLInputElement>('input[data-loop]')];
  return {
    id: data['id'] === undefined || data['id'] === '' ? null : data['id'],
    key: data['key'] ?? '',
    title: valueOf(row, 'title'),
    bracket: valueOf(row, 'bracket') as DraftStage['bracket'],
    exitGate: valueOf(row, 'exitGate') as DraftStage['exitGate'],
    agentPickup: valueOf(row, 'agentPickup') as DraftStage['agentPickup'],
    connector: valueOf(row, 'connector') as DraftStage['connector'],
    wipLimit: Math.max(0, Math.trunc(Number(valueOf(row, 'wipLimit')) || 0)),
    instructionsPageId: data['instructions'] === '' ? null : (data['instructions'] ?? null),
    validators: (data['validators'] ?? '').split(',').filter((key) => key !== ''),
    feeds: loops.filter((loop) => loop.checked).map((loop) => loop.value),
  };
}

function rowsOf(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-draft-rows] > [data-draft-row]')];
}

function freshKey(root: Element): string {
  const taken = new Set(rowsOf(root).map((row) => row.dataset['key']));
  let n = 1;
  while (taken.has(`stage_${n}`)) n += 1;
  return `stage_${n}`;
}

function loopBox(document: Document, key: string, checked: boolean): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'inline-flex items-center gap-1 text-sm';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'outline-offset-2 outline-accent-text focus-visible:outline-2';
  box.setAttribute('data-loop', '');
  box.value = key;
  box.checked = checked;
  label.append(box, key);
  return label;
}

function syncLoops(root: Element): void {
  const document = root.ownerDocument;
  const keys = rowsOf(root).map((row) => row.dataset['key'] ?? '');
  for (const row of rowsOf(root)) {
    const set = row.querySelector('[data-loops]');
    if (set === null) continue;
    const ticked = new Set(stageOf(row).feeds);
    const legend = set.querySelector('legend');
    set.replaceChildren(...(legend === null ? [] : [legend]));
    for (const key of keys.filter((entry) => entry !== row.dataset['key']))
      set.append(loopBox(document, key, ticked.has(key)));
  }
}

function addRow(root: Element): void {
  const template = root.querySelector<HTMLTemplateElement>('template[data-draft-template]');
  const rows = root.querySelector('[data-draft-rows]');
  const row = template?.content.firstElementChild?.cloneNode(true);
  if (!(row instanceof root.ownerDocument.defaultView!.HTMLElement) || rows === null) return;
  const key = freshKey(root);
  row.dataset['key'] = key;
  const code = row.querySelector('code');
  if (code !== null) code.textContent = key;
  rows.append(row);
  syncLoops(root);
  row.querySelector<HTMLInputElement>('[name="title"]')?.focus();
}

function moveRow(row: HTMLElement, way: string): void {
  if (way === 'up' && row.previousElementSibling !== null) row.previousElementSibling.before(row);
  if (way === 'down' && row.nextElementSibling !== null) row.nextElementSibling.after(row);
}

function setStatus(root: Element, text: string): void {
  const status = root.querySelector('[data-draft-status]');
  if (status !== null) status.textContent = text;
}

function problemItem(document: Document, problem: DraftProblem): HTMLLIElement {
  const item = document.createElement('li');
  item.className = problemStyle;
  item.dataset['code'] = problem.code;
  item.textContent = problem.message;
  return item;
}

function placeProblems(root: Element, problems: readonly DraftProblem[]): void {
  const document = root.ownerDocument;
  const slots = new Map(
    rowsOf(root).map((row) => [row.dataset['key'] ?? '', row.querySelector('[data-problems]')]),
  );
  for (const slot of slots.values()) slot?.replaceChildren();
  const general = root.querySelector('[data-draft-general]');
  general?.replaceChildren();
  for (const problem of problems) {
    const slot = slots.get(problem.stage ?? '') ?? general;
    slot?.append(problemItem(document, problem));
  }
}

function checkWords(count: number): string {
  if (count === 0) return cleanCheck;
  return count === 1
    ? '1 problem to fix before publishing.'
    : `${count} problems to fix before publishing.`;
}

function showProblems(root: Element, problems: readonly DraftProblem[]): void {
  placeProblems(root, problems);
  setStatus(root, checkWords(problems.length));
  const publish = root.querySelector('[data-draft-publish]');
  if (problems.length === 0) publish?.removeAttribute('aria-disabled');
  else publish?.setAttribute('aria-disabled', 'true');
}

function setRevision(root: HTMLElement, revision: number): void {
  root.dataset['revision'] = String(revision);
  const hidden = root.querySelector<HTMLInputElement>('[data-draft-revision]');
  if (hidden !== null) hidden.value = String(revision);
}

async function reasonOf(response: Response | null): Promise<string> {
  const body: unknown = await response?.json().catch(() => null);
  const reason = (body as { readonly reason?: unknown } | null)?.reason;
  return typeof reason === 'string' ? reason : 'internal_error';
}

type Checked = readonly DraftProblem[] | null;

async function saveAndCheck(root: HTMLElement, deps: DraftDeps): Promise<Checked> {
  const harness = encodeURIComponent(root.dataset['harness'] ?? '');
  const body = {
    command: 'save_workflow_draft',
    requestId: deps.uuid(),
    revision: Number(root.dataset['revision']),
    stages: rowsOf(root).map(stageOf),
  };
  const saved = await deps
    .fetch(`/api/harness/${harness}/commands/save_workflow_draft`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    })
    .catch(() => null);
  if (saved === null || !saved.ok) {
    setStatus(root, reasonText(await reasonOf(saved)));
    return null;
  }
  setRevision(root, body.revision + 1);
  const checked = await deps
    .fetch(`/api/harness/${harness}/draft`, { headers: { accept: 'application/json' } })
    .catch(() => null);
  const parsed = draftCheckSchema.safeParse(await checked?.json().catch(() => null));
  if (!parsed.success) {
    setStatus(root, reasonText(await reasonOf(checked)));
    return null;
  }
  setRevision(root, parsed.data.revision);
  return parsed.data.problems;
}

type DraftState = {
  timer: unknown;
  dirty: boolean;
  saving: Promise<void> | null;
  publishAfter: boolean;
};

function holdPublish(root: Element): void {
  root.querySelector('[data-draft-publish]')?.setAttribute('aria-disabled', 'true');
}

function publishNow(root: Element): void {
  const button = root.querySelector<HTMLButtonElement>('[data-draft-publish]');
  const form = button?.closest('form');
  if (button !== null && form !== null && form !== undefined) form.requestSubmit(button);
}

function settleCheck(root: HTMLElement, state: DraftState, problems: Checked): void {
  if (state.dirty) return;
  const ready = problems !== null && problems.length === 0;
  if (problems !== null) showProblems(root, problems);
  if (state.publishAfter && ready) publishNow(root);
  state.publishAfter = false;
}

function onClick(root: HTMLElement, target: Element, changed: () => void): void {
  const button = target.closest('button[data-draft-add], button[data-move], button[data-remove]');
  if (button === null) return;
  const row = button.closest<HTMLElement>('[data-draft-row]');
  if (button.hasAttribute('data-draft-add')) addRow(root);
  else if (row !== null && button.hasAttribute('data-remove')) {
    row.remove();
    syncLoops(root);
  } else if (row !== null) moveRow(row, button.getAttribute('data-move') ?? '');
  changed();
}

function rootOf(event: Event): { root: HTMLElement; target: Element } | null {
  const target = event.target as Element | null;
  const root = target?.closest<HTMLElement>('[data-draft-editor]') ?? null;
  return target === null || root === null ? null : { root, target };
}

function draftStates(deps: DraftDeps) {
  const states = new WeakMap<HTMLElement, DraftState>();
  const stateOf = (root: HTMLElement): DraftState => {
    const known = states.get(root);
    if (known !== undefined) return known;
    const fresh: DraftState = { timer: undefined, dirty: false, saving: null, publishAfter: false };
    states.set(root, fresh);
    return fresh;
  };
  const flush = async (root: HTMLElement): Promise<void> => {
    const state = stateOf(root);
    if (state.timer !== undefined) deps.timers.clearTimeout(state.timer);
    state.timer = undefined;
    while (state.saving !== null) await state.saving;
    if (!state.dirty) return settleCheck(root, state, null);
    state.dirty = false;
    state.saving = saveAndCheck(root, deps).then((problems) => {
      state.saving = null;
      settleCheck(root, state, problems);
    });
    await state.saving;
  };
  const changed = (root: HTMLElement): void => {
    redrawMap(root);
    const state = stateOf(root);
    state.dirty = true;
    holdPublish(root);
    setStatus(root, 'Checking… (2 seconds after your last change)');
    if (state.timer !== undefined) deps.timers.clearTimeout(state.timer);
    state.timer = deps.timers.setTimeout(() => void flush(root), DRAFT_CHECK_MS);
  };
  const publishing = (root: HTMLElement): void => {
    const state = stateOf(root);
    if (!state.dirty && state.saving === null) return;
    state.publishAfter = true;
    void flush(root);
  };
  return { changed, publishing };
}

export function wireDraftEditor(document: Document, deps: DraftDeps): void {
  const drafts = draftStates(deps);
  const hitTest = deps.hitTest ?? ((x: number, y: number) => document.elementFromPoint(x, y));
  wireDraftMap(document, hitTest, drafts.changed);
  const edited = (event: Event) => {
    const found = rootOf(event);
    if (found?.target.closest('[data-draft-rows]')) drafts.changed(found.root);
  };
  document.addEventListener('input', edited);
  document.addEventListener('change', edited);
  document.addEventListener('click', (event) => {
    const found = rootOf(event);
    if (found === null) return;
    if (found.target.closest('[data-draft-publish]')) drafts.publishing(found.root);
    else onClick(found.root, found.target, () => drafts.changed(found.root));
  });
}
