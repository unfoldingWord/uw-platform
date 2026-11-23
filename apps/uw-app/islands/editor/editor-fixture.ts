import type { CrepeBuilder } from '@milkdown/crepe/builder';
import { editorViewCtx } from '@milkdown/kit/core';
import type { JSDOM } from 'jsdom';
import type { Collaboration, Joined } from './collaboration.ts';
import { installDom } from './test-dom.ts';

let dom: JSDOM | null = null;

export function win(): JSDOM['window'] {
  if (dom === null) throw new Error('no page yet');
  return dom.window;
}

const MAC = /Mac|iP(hone|[oa]d)/.test(globalThis.navigator.platform);
export const RULES = '## Rules\n\nUse **strong** passwords.';
export const PAGE_ID = '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11';

function escaped(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

export function page(markdown: string): Document {
  const made = installDom(
    `<!DOCTYPE html><body><form>
      <div data-editor data-page="${PAGE_ID}" data-style-nonce="bm9uY2U=" hidden>
        <div data-editor-surface></div>
        <ul data-editor-menu hidden></ul>
        <template data-editor-menu-row><li role="option"><span data-title></span><span data-meta></span></li></template>
      </div>
      <p data-editor-status></p>
      <span data-editor-mode>Joining the working draft</span>
      <div data-editor-text><textarea name="bodyMd">${escaped(markdown)}</textarea></div>
      <div data-upload data-page="${PAGE_ID}"><input type="file" data-upload-input><p data-upload-status></p></div>
      <button type="submit">Save</button>
    </form></body>`,
    'https://uw.example/pages/x/edit',
  );
  dom = made;
  return made.window.document;
}

const ENTRIES = [
  {
    id: PAGE_ID,
    title: 'Travel Policy',
    type: 'learning',
    jdArea: '00-09',
    jdId: '01.47',
    aliases: [],
  },
];

export const deps = {
  fetch: () => Promise.resolve(Response.json({ entries: ENTRIES })),
  uuid: () => '00000000-0000-4000-8000-00000000f11e',
};

export function submitted(document: Document): { readonly sent: boolean; readonly body: string } {
  const form = document.querySelector('form');
  const event = new (win().Event)('submit', { bubbles: true, cancelable: true });
  form?.dispatchEvent(event);
  const body = document.querySelector<HTMLTextAreaElement>('textarea')?.value ?? '';
  return { sent: !event.defaultPrevented, body };
}

export function submit(document: Document): string {
  return submitted(document).body;
}

export function typeText(editor: CrepeBuilder | null, text: string): void {
  editor?.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    for (const letter of text) {
      const { from, to } = view.state.selection;
      const typed = () => view.state.tr.insertText(letter, from, to);
      const handled = view.someProp('handleTextInput', (handle) =>
        handle(view, from, to, letter, typed),
      );
      if (handled !== true) view.dispatch(typed());
    }
  });
}

export function press(editor: CrepeBuilder | null, key: string, withMod = false): void {
  editor?.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const mod = withMod ? { metaKey: MAC, ctrlKey: !MAC } : {};
    const event = new (win().KeyboardEvent)('keydown', { key, ...mod });
    view.someProp('handleKeyDown', (handle) => handle(view, event));
  });
}

export function pendingDraft() {
  let answer: (how: Joined) => void = () => undefined;
  const answered = new Promise<Joined>((resolve) => {
    answer = resolve;
  });
  let destroyed = false;
  const shared: Collaboration = {
    plugins: [],
    ready: () => answered,
    snapshot: () => 'c25hcHNob3Q=',
    destroy: () => {
      destroyed = true;
    },
  };
  return { shared, answer: (how: Joined) => answer(how), destroyed: () => destroyed };
}

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

export function saveButton(document: Document): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('button[type="submit"]');
}

function clipboard(text: string, html: string): ClipboardEvent {
  const event = new (win().Event)('paste', { bubbles: true, cancelable: true });
  const kinds = new Map([
    ['text/plain', text],
    ['text/html', html],
  ]);
  const data = { getData: (type: string) => kinds.get(type) ?? '', types: [...kinds.keys()] };
  Object.defineProperty(event, 'clipboardData', { value: data });
  return event as ClipboardEvent;
}

export function paste(editor: CrepeBuilder | null, text: string, html = ''): void {
  editor?.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    if (html === '') view.pasteText(text, clipboard(text, html));
    else view.pasteHTML(html, clipboard(text, html));
  });
}
