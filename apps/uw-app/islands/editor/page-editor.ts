import type { CrepeBuilder } from '@milkdown/crepe/builder';
import { insert } from '@milkdown/kit/utils';
import { pageIndexReplySchema } from '@uw/contracts';
import { markdownFor, notAdded, uploadFile, type Placed } from '../browser/page-upload.ts';
import { createMatcher, type Matcher } from '../browser/switcher-match.ts';
import type { Collaboration } from './collaboration.ts';
import { pageEditor, sharedHistory } from './crepe-editor.ts';
import { createMenu } from './menu.ts';
import { pagePicker } from './page-picker.ts';
import { sameMeaning } from './same-meaning.ts';
import { pageSlashItems } from './slash-items.ts';

export type EditorDeps = {
  readonly fetch: typeof fetch;
  readonly uuid: () => string;
  readonly collaboration?: (root: HTMLElement) => Collaboration | null;
};

type Parts = {
  readonly root: HTMLElement;
  readonly form: HTMLFormElement;
  readonly surface: HTMLElement;
  readonly area: HTMLTextAreaElement;
  readonly initial: string;
};

const INDEX = '/api/pages/index';
const noMatch: Matcher = () => [];
function within<T extends Element>(scope: Element | null, selector: string): T | null {
  return scope?.querySelector<T>(selector) ?? null;
}

function partsOf(document: Document): Parts | null {
  const root = document.querySelector<HTMLElement>('[data-editor]');
  const form = root?.closest('form') ?? null;
  const surface = within<HTMLElement>(root, '[data-editor-surface]');
  const area = within<HTMLTextAreaElement>(form, 'textarea[name="bodyMd"]');
  if (root === null || form === null || surface === null || area === null) return null;
  return { root, form, surface, area, initial: area.value };
}

function sharing(form: Element, live: boolean): void {
  form.toggleAttribute('data-draft-live', live);
  const mode = form.querySelector('[data-editor-mode]');
  if (mode !== null) mode.textContent = live ? 'Working draft' : 'Editing on your own';
}

function say(root: Element, words: string): void {
  const status = root.querySelector('[data-editor-status]');
  if (status !== null) status.textContent = words;
}

async function loadPages(send: typeof fetch): Promise<Matcher> {
  try {
    const response = await send(INDEX, { headers: { accept: 'application/json' } });
    return createMatcher(pageIndexReplySchema.parse(await response.json()).entries);
  } catch {
    return noMatch;
  }
}

function uploader(parts: Parts, deps: EditorDeps) {
  const region = parts.form.querySelector('[data-upload]');
  const status = parts.form.querySelector('[data-upload-status]');
  const say = (words: string) => {
    if (status !== null) status.textContent = words;
  };
  return async (file: File): Promise<Placed> => {
    say(`Adding ${file.name}`);
    const outcome = region === null ? 'not_wired' : await uploadFile(region, file, deps);
    if (typeof outcome === 'string') {
      say(notAdded(outcome));
      throw new Error(outcome);
    }
    say(`Added ${outcome.name}. Save the page to keep it.`);
    return outcome;
  };
}

type Upload = ReturnType<typeof uploader>;

type Mounting = {
  readonly parts: Parts;
  readonly deps: EditorDeps;
  readonly upload: Upload;
  readonly pickFile: () => void;
};

type Active = {
  editor: CrepeBuilder;
  baseline: string;
  shared: Collaboration | null;
  joined: boolean;
};

function uploadInput(parts: Parts): HTMLInputElement | null {
  return parts.form.querySelector<HTMLInputElement>('[data-upload-input]');
}

function wireUploads(parts: Parts, active: Active, upload: Upload): void {
  const input = uploadInput(parts);
  input?.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file === undefined) return;
    void upload(file)
      .then((placed) => {
        active.editor.editor.action(insert(markdownFor(placed)));
        input.value = '';
      })
      .catch(() => undefined);
  });
}

async function mount(mounting: Mounting, shared: Collaboration | null): Promise<CrepeBuilder> {
  const { parts, deps, upload } = mounting;
  const menu = createMenu(parts.root);
  let pages: Matcher = noMatch;
  const editor = pageEditor({
    root: parts.surface,
    markdown: parts.initial,
    styleNonce: parts.root.getAttribute('data-style-nonce') ?? '',
    upload: async (file) => (await upload(file)).url,
    slashItems: pageSlashItems(mounting.pickFile),
    plugins: [
      ...(menu === null ? [] : [pagePicker({ menu, pages: () => pages })]),
      ...(shared?.plugins ?? []),
    ],
  });
  if (shared !== null) await sharedHistory(editor);
  await editor.create();
  void loadPages(deps.fetch).then((loaded) => {
    pages = loaded;
  });
  return editor;
}

function savingWith(form: HTMLFormElement, enabled: boolean): void {
  for (const button of form.querySelectorAll<HTMLButtonElement>('button[type="submit"]')) {
    button.disabled = !enabled;
  }
}

function stateField(form: HTMLFormElement): HTMLInputElement {
  const found = form.querySelector<HTMLInputElement>('input[name="draftState"]');
  if (found !== null) return found;
  const field = form.ownerDocument.createElement('input');
  field.type = 'hidden';
  field.name = 'draftState';
  form.append(field);
  return field;
}

function wireSubmit(parts: Parts, active: Active): void {
  parts.form.addEventListener('submit', (event) => {
    if (!parts.form.hasAttribute('data-editor-active')) return;
    if (!active.joined) {
      event.preventDefault();
      return;
    }
    const markdown = active.editor.getMarkdown();
    parts.area.value = markdown === active.baseline ? parts.initial : markdown;
    stateField(parts.form).value = active.shared?.snapshot() ?? '';
  });
}

function showAsText(parts: Parts, why: string): void {
  sharing(parts.form, false);
  parts.root.hidden = true;
  parts.form.removeAttribute('data-editor-active');
  parts.form.querySelector<HTMLElement>('[data-editor-text]')?.removeAttribute('hidden');
  say(parts.form, why);
}

function ready(parts: Parts, active: Active, live: boolean): CrepeBuilder {
  sharing(parts.form, live);
  active.editor.setReadonly(false);
  active.joined = true;
  savingWith(parts.form, true);
  return active.editor;
}

async function joined(mounting: Mounting, active: Active, shared: Collaboration) {
  const { parts } = mounting;
  savingWith(parts.form, false);
  active.editor.setReadonly(true);
  say(parts.form, 'Joining the shared draft.');
  if ((await shared.ready(active.editor, parts.initial)) !== 'unavailable') {
    return ready(parts, active, true);
  }
  shared.destroy();
  await active.editor.destroy();
  active.shared = null;
  active.editor = await mount(mounting, null);
  active.baseline = active.editor.getMarkdown();
  say(parts.form, 'Editing together is not available right now, so you are editing on your own.');
  return ready(parts, active, false);
}

export async function startPageEditor(
  document: Document,
  deps: EditorDeps,
): Promise<CrepeBuilder | null> {
  const parts = partsOf(document);
  if (parts === null) return null;
  const upload = uploader(parts, deps);
  const mounting = { parts, deps, upload, pickFile: () => uploadInput(parts)?.click() };
  const shared = deps.collaboration?.(parts.root) ?? null;
  const editor = await mount(mounting, shared);
  if (!sameMeaning(parts.initial, editor.getMarkdown())) {
    await editor.destroy();
    shared?.destroy();
    showAsText(parts, 'This page uses formatting the editor cannot show yet, so it opens as text.');
    return null;
  }
  parts.root.hidden = false;
  parts.form.setAttribute('data-editor-active', '');
  parts.form.querySelector<HTMLElement>('[data-editor-text]')?.setAttribute('hidden', '');
  const active: Active = { editor, baseline: editor.getMarkdown(), shared, joined: false };
  wireSubmit(parts, active);
  wireUploads(parts, active, upload);
  return shared === null ? ready(parts, active, false) : joined(mounting, active, shared);
}
