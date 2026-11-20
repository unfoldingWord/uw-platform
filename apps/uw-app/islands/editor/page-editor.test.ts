import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';

type Start = typeof import('./page-editor.ts').startPageEditor;

let start: Start;
let dom: JSDOM;

const globals = [
  'window',
  'document',
  'navigator',
  'Node',
  'Element',
  'HTMLElement',
  'DOMParser',
  'MutationObserver',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
] as const;

function install(next: JSDOM): void {
  dom = next;
  for (const name of globals) {
    Object.defineProperty(globalThis, name, {
      value: name === 'window' ? next.window : Reflect.get(next.window, name),
      configurable: true,
      writable: true,
    });
  }
}

const RULES = '## Rules\n\nUse **strong** passwords.';
const RULES_HTML = '<h2>Rules</h2><p>Use <strong>strong</strong> passwords.</p>';

function page(markdown: string, content: string): Document {
  install(
    new JSDOM(
      `<!DOCTYPE html><body><form>
        <div data-editor hidden>
          <button type="button" data-format="bold" aria-pressed="false">B</button>
          <div data-editor-surface></div>
          <template data-editor-content>${content}</template>
          <ul data-editor-menu hidden></ul>
          <template data-editor-menu-row><li role="option"><span data-title></span></li></template>
        </div>
        <p data-editor-status></p>
        <div data-editor-text><textarea name="bodyMd">${markdown}</textarea></div>
        <button type="submit">Save</button>
      </form></body>`,
      { url: 'https://uw.example/pages/x/edit', pretendToBeVisual: true },
    ),
  );
  return dom.window.document;
}

const deps = {
  fetch: () => Promise.resolve(Response.json({ entries: [] })),
  uuid: () => '00000000-0000-4000-8000-00000000f11e',
};

function submitted(document: Document): { readonly sent: boolean; readonly body: string } {
  const form = document.querySelector('form');
  const event = new dom.window.Event('submit', { bubbles: true, cancelable: true });
  form?.dispatchEvent(event);
  const body = document.querySelector<HTMLTextAreaElement>('textarea')?.value ?? '';
  return { sent: !event.defaultPrevented, body };
}

function submit(document: Document): string {
  return submitted(document).body;
}

type Answer = 'joined' | 'seeded' | 'unavailable';

function pendingDraft() {
  let answer: (how: Answer) => void = () => undefined;
  const answered = new Promise<Answer>((resolve) => {
    answer = resolve;
  });
  let destroyed = false;
  const shared = {
    extensions: [],
    ready: () => answered,
    snapshot: () => 'c25hcHNob3Q=',
    destroy: () => {
      destroyed = true;
    },
  };
  return { shared, answer: (how: Answer) => answer(how), destroyed: () => destroyed };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function saveButton(document: Document): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('button[type="submit"]');
}

beforeAll(async () => {
  install(new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://uw.example/' }));
  start = (await import('./page-editor.ts')).startPageEditor;
});

describe('#175 the editor takes over the text field, and hands markdown back on save', () => {
  it('shows the editor, hides the text field, and saves the page unchanged when nothing was typed', async () => {
    const markdown = RULES;
    const document = page(markdown, RULES_HTML);
    const editor = await start(document, deps);
    expect(editor).not.toBeNull();
    expect(document.querySelector('[data-editor]')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('[data-editor-text]')?.hasAttribute('hidden')).toBe(true);
    expect(submit(document)).toBe(markdown);
  });

  it('writes what was typed and formatted as markdown', async () => {
    const document = page('First line.', '<p>First line.</p>');
    const editor = await start(document, deps);
    editor?.commands.selectAll();
    document.querySelector<HTMLButtonElement>('[data-format="bold"]')?.click();
    expect(document.querySelector('[data-format="bold"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    editor?.commands.insertContentAt(editor.state.doc.content.size, '<p>Second line.</p>');
    expect(submit(document)).toBe('**First line.**\n\nSecond line.');
  });

  it('opens as text, and says why, when the editor would lose part of the page', async () => {
    const lossy = '<p>Kept text.</p><dl><dt>Term</dt><dd>Meaning</dd></dl>';
    const document = page('Kept text.', lossy);
    expect(await start(document, deps)).toBeNull();
    expect(document.querySelector('[data-editor]')?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('[data-editor-text]')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('[data-editor-status]')?.textContent).toContain('opens as text');
    expect(submit(document)).toBe('Kept text.');
  });

  it('does nothing on a screen with no editor', async () => {
    install(new JSDOM('<!DOCTYPE html><body><form></form></body>'));
    expect(await start(dom.window.document, deps)).toBeNull();
  });
});

describe('#175 nothing is typed or saved until the shared draft is ready', () => {
  it('holds Save and typing while joining, then saves the draft with its state', async () => {
    const document = page(RULES, RULES_HTML);
    const draft = pendingDraft();
    const started = start(document, { ...deps, collaboration: () => draft.shared });
    await tick();
    expect(saveButton(document)?.disabled).toBe(true);
    expect(document.querySelector('[data-editor-input]')?.getAttribute('contenteditable')).toBe(
      'false',
    );
    expect(submitted(document).sent).toBe(false);
    draft.answer('joined');
    const editor = await started;
    expect(saveButton(document)?.disabled).toBe(false);
    expect(editor?.isEditable).toBe(true);
    editor?.commands.insertContentAt(0, '<p>Joined.</p>');
    const saved = submitted(document);
    expect(saved.sent).toBe(true);
    expect(saved.body.startsWith('Joined.')).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[name="draftState"]')?.value).toBe(
      'c25hcHNob3Q=',
    );
  });

  it('edits alone from the saved text when the shared draft never answers', async () => {
    const document = page(RULES, RULES_HTML);
    const draft = pendingDraft();
    const started = start(document, { ...deps, collaboration: () => draft.shared });
    draft.answer('unavailable');
    const editor = await started;
    expect(draft.destroyed()).toBe(true);
    expect(editor?.isEditable).toBe(true);
    expect(saveButton(document)?.disabled).toBe(false);
    expect(document.querySelector('[data-editor-status]')?.textContent).toContain(
      'editing on your own',
    );
    expect(submit(document)).toBe(RULES);
    expect(document.querySelector<HTMLInputElement>('input[name="draftState"]')?.value).toBe('');
  });
});
