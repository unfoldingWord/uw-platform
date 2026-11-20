import { createNodeFromContent, Editor, getHTMLFromFragment, getSchema } from '@tiptap/core';
import type { Node as PageNode } from '@tiptap/pm/model';
import { pageIndexReplySchema } from '@uw/contracts';
import { markdownFromEditor } from './from-editor.ts';
import { markdownFor } from '../browser/page-upload.ts';
import { createMatcher, type Matcher } from '../browser/switcher-match.ts';
import type { Collaboration } from './collaboration.ts';
import { pageExtensions } from './extensions.ts';
import { applyFormat, isFormatActive } from './formats.ts';
import { createMenu } from './menu.ts';
import { suggestionMenus } from './suggestions.ts';

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
  const content = within<HTMLTemplateElement>(root, '[data-editor-content]');
  if (root === null || form === null || surface === null || area === null) return null;
  return { root, form, surface, area, initial: content?.innerHTML ?? '' };
}

function say(root: Element, words: string): void {
  const status = root.querySelector('[data-editor-status]');
  if (status !== null) status.textContent = words;
}

function wireToolbar(root: Element, editor: Editor): void {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-format]')];
  root.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest('[data-format]') ?? null;
    if (button === null) return;
    event.preventDefault();
    applyFormat(editor, button.getAttribute('data-format') ?? '');
  });
  const refresh = () => {
    for (const button of buttons) {
      const active = isFormatActive(editor, button.getAttribute('data-format') ?? '');
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.toggleAttribute('data-on', active);
    }
  };
  editor.on('transaction', refresh);
  refresh();
}

async function loadPages(send: typeof fetch): Promise<Matcher> {
  try {
    const response = await send(INDEX, { headers: { accept: 'application/json' } });
    return createMatcher(pageIndexReplySchema.parse(await response.json()).entries);
  } catch {
    return noMatch;
  }
}

function insertFile(editor: Editor, file: Parameters<typeof markdownFor>[0]): void {
  if (file.contentType.startsWith('image/')) {
    editor.chain().focus().setImage({ src: file.url, alt: file.name }).run();
    return;
  }
  const mark = { type: 'link', attrs: { href: file.url } };
  editor
    .chain()
    .focus()
    .insertContent({ type: 'text', text: file.name, marks: [mark] })
    .run();
}

function wireUploads(parts: Parts, editor: Editor, deps: EditorDeps): () => void {
  const input = parts.form.querySelector<HTMLInputElement>('[data-upload-input]');
  const region = input?.closest('[data-upload]') ?? null;
  const status = region?.querySelector('[data-upload-status]') ?? null;
  input?.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file === undefined || region === null) return;
    const page = encodeURIComponent(region.getAttribute('data-page') ?? '');
    const url = `/api/files/${deps.uuid()}?page=${page}&name=${encodeURIComponent(file.name)}`;
    void deps
      .fetch(url, { method: 'PUT', headers: { 'content-type': file.type }, body: file })
      .then((response) => response.json())
      .then((body: { file?: Parameters<typeof markdownFor>[0]; reason?: string }) => {
        if (body.file === undefined) throw new Error(body.reason ?? 'internal_error');
        insertFile(editor, body.file);
        input.value = '';
        if (status !== null)
          status.textContent = `Added ${body.file.name}. Save the page to keep it.`;
      })
      .catch(() => {
        if (status !== null) status.textContent = 'Not added: the file could not be stored.';
      });
  });
  return () => input?.click();
}

function showAsText(parts: Parts, why: string): void {
  parts.root.hidden = true;
  parts.form.removeAttribute('data-editor-active');
  parts.form.querySelector<HTMLElement>('[data-editor-text]')?.removeAttribute('hidden');
  say(parts.form, why);
}

function sameMeaning(before: string, after: string): boolean {
  return markdownFromEditor(before) === markdownFromEditor(after);
}

function mount(parts: Parts, deps: EditorDeps, shared: Collaboration | null): Editor {
  const menu = createMenu(parts.root);
  let pages: Matcher = noMatch;
  let pickFile = () => undefined as void;
  const menus =
    menu === null
      ? []
      : [suggestionMenus({ menu, pages: () => pages, pickFile: () => pickFile() })];
  const editor = new Editor({
    element: parts.surface,
    injectCSS: false,
    extensions: [
      ...pageExtensions({ history: shared === null }),
      ...(shared?.extensions ?? []),
      ...menus,
    ],
    content: shared === null ? parts.initial : '',
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Page text',
        'data-editor-input': '',
      },
    },
  });
  pickFile = wireUploads(parts, editor, deps);
  void loadPages(deps.fetch).then((loaded) => {
    pages = loaded;
  });
  return editor;
}

type Active = { editor: Editor | null; shared: Collaboration | null };

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
    if (active.editor === null) {
      event.preventDefault();
      return;
    }
    parts.area.value = markdownFromEditor(active.editor.getHTML());
    stateField(parts.form).value = active.shared?.snapshot() ?? '';
  });
}

function ready(parts: Parts, active: Active, editor: Editor): Editor {
  wireToolbar(parts.root, editor);
  editor.setEditable(true);
  active.editor = editor;
  savingWith(parts.form, true);
  return editor;
}

function shows(initial: string): boolean {
  const schema = getSchema(pageExtensions({ history: false }));
  const node = createNodeFromContent(initial, schema, { slice: false }) as PageNode;
  return sameMeaning(initial, getHTMLFromFragment(node.content, schema));
}

export async function startPageEditor(
  document: Document,
  deps: EditorDeps,
): Promise<Editor | null> {
  const parts = partsOf(document);
  if (parts === null) return null;
  if (!shows(parts.initial)) {
    showAsText(parts, 'This page uses formatting the editor cannot show yet, so it opens as text.');
    return null;
  }
  parts.root.hidden = false;
  parts.form.setAttribute('data-editor-active', '');
  parts.form.querySelector<HTMLElement>('[data-editor-text]')?.setAttribute('hidden', '');
  const active: Active = { editor: null, shared: deps.collaboration?.(parts.root) ?? null };
  wireSubmit(parts, active);
  const { shared } = active;
  if (shared === null) return ready(parts, active, mount(parts, deps, null));
  savingWith(parts.form, false);
  say(parts.form, 'Joining the shared draft.');
  const editor = mount(parts, deps, shared);
  editor.setEditable(false);
  if ((await shared.ready(editor, parts.initial)) !== 'unavailable') {
    return ready(parts, active, editor);
  }
  shared.destroy();
  editor.destroy();
  active.shared = null;
  say(parts.form, 'Editing together is not available right now, so you are editing on your own.');
  return ready(parts, active, mount(parts, deps, null));
}
