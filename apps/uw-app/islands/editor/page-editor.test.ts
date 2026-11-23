import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it, vi } from 'vitest';

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
        <span data-editor-mode>Joining the working draft</span>
        <div data-editor-text><textarea name="bodyMd">${markdown}</textarea></div>
        <div data-upload data-page="p1"><input type="file" data-upload-input /><p data-upload-status></p></div>
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
    expect(document.querySelector('form')?.hasAttribute('data-draft-live')).toBe(true);
    expect(document.querySelector('[data-editor-mode]')?.textContent).toBe('Working draft');
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
    expect(document.querySelector('form')?.hasAttribute('data-draft-live')).toBe(false);
    expect(document.querySelector('[data-editor-mode]')?.textContent).toBe('Editing on your own');
    expect(submit(document)).toBe(RULES);
    expect(document.querySelector<HTMLInputElement>('input[name="draftState"]')?.value).toBe('');
  });
});

describe('#214 a video added while editing shows as a video and saves as an embed', () => {
  const url = '/api/files/00000000-0000-4000-8000-0000000000a1';
  const storing: Parameters<Start>[1] = {
    ...deps,
    fetch: (_input, init) =>
      Promise.resolve(
        init?.method === 'PUT'
          ? Response.json({ file: { name: 'Walkthrough', contentType: 'video/mp4', url } })
          : Response.json({ entries: [] }),
      ),
  };

  it('draws a player where the cursor is and writes the same markdown embed', async () => {
    const document = page('Watch this.', '<p>Watch this.</p>');
    const editor = await start(document, storing);
    editor?.commands.focus('end');
    const input = document.querySelector<HTMLInputElement>('[data-upload-input]');
    const video = new dom.window.File(['x'], 'walkthrough.mp4', { type: 'video/mp4' });
    Object.defineProperty(input, 'files', { value: [video] });
    input?.dispatchEvent(new dom.window.Event('change'));
    await vi.waitFor(() => {
      expect(document.querySelector('[data-editor-surface] video')?.getAttribute('src')).toBe(url);
    });
    expect(submit(document)).toBe(`Watch this.![Walkthrough](${url})`);
  });
});

describe('#214 a video in a working draft shows as a video, and its controls stay with the player', () => {
  const url = '/api/files/00000000-0000-4000-8000-0000000000a1';

  it('marks a video the shared draft loaded as a picture, and saves the same embed', async () => {
    const document = page('Watch this.', '<p>Watch this.</p>');
    document.querySelector('[data-editor]')?.setAttribute('data-video-files', url);
    const shared = {
      ...pendingDraft().shared,
      ready: (editor: { commands: { setContent: (html: string) => void } }) => {
        editor.commands.setContent(`<p>Watch this.</p><p><img src="${url}" alt="Clip"></p>`);
        return Promise.resolve('joined' as const);
      },
    };
    await start(document, { ...deps, collaboration: () => shared });
    expect(document.querySelector('[data-editor-surface] video')?.getAttribute('src')).toBe(url);
    expect(submit(document)).toBe(`Watch this.\n\n![Clip](${url})`);
  });

  it('keeps a drag that starts on the player from moving the video', async () => {
    const document = page(`![Clip](${url})`, `<p><img src="${url}" alt="Clip"></p>`);
    document.querySelector('[data-editor]')?.setAttribute('data-video-files', url);
    await start(document, deps);
    const drag = new dom.window.Event('dragstart', { bubbles: true, cancelable: true });
    document.querySelector('[data-editor-surface] video')?.dispatchEvent(drag);
    expect(drag.defaultPrevented).toBe(true);
  });
});

function clipboard(text: string, html: string): ClipboardEvent {
  const event = new dom.window.Event('paste', { bubbles: true, cancelable: true });
  const kinds = new Map([
    ['text/plain', text],
    ['text/html', html],
  ]);
  const data = { getData: (type: string) => kinds.get(type) ?? '' };
  Object.defineProperty(event, 'clipboardData', { value: data });
  return event as ClipboardEvent;
}

const PASTED = [
  '> Pro Tip: search this page.',
  '## Overview',
  'unfoldingWord uses [Johnny.Decimal](https://johnnydecimal.com/) for **knowledge**.',
  '- Areas\n- Categories',
].join('\n\n');

describe('pasting markdown keeps its formatting', () => {
  it('turns pasted markdown text into headings, quotes, links and lists', async () => {
    const document = page('', '<p></p>');
    const editor = await start(document, deps);
    editor?.view.pasteText(PASTED, clipboard(PASTED, ''));
    const html = editor?.getHTML() ?? '';
    expect(html).toContain('<h2>Overview</h2>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('href="https://johnnydecimal.com/"');
    expect(submit(document)).toBe(PASTED);
  });

  it('reads markdown from a code editor whose copy carries only coloured text', async () => {
    const document = page('', '<p></p>');
    const editor = await start(document, deps);
    const html = '<div><span style="color:#569cd6">## Overview</span></div>';
    editor?.view.pasteHTML(html, clipboard('## Overview', html));
    expect(editor?.getHTML()).toContain('<h2>Overview</h2>');
  });

  it('keeps formatted text copied from a web page as it was', async () => {
    const document = page('', '<p></p>');
    const editor = await start(document, deps);
    const html = '<p><strong>Bold</strong> # not a heading</p>';
    editor?.view.pasteHTML(html, clipboard('**Bold** # not a heading', html));
    expect(editor?.getHTML()).toContain('<strong>Bold</strong> # not a heading');
  });

  it('pastes plain words as plain words', async () => {
    const document = page('', '<p></p>');
    const editor = await start(document, deps);
    editor?.view.pasteText('Just words.', clipboard('Just words.', ''));
    expect(submit(document)).toBe('Just words.');
  });

  it('pastes markdown into a code block as the characters typed', async () => {
    const document = page('', '<pre><code>x</code></pre>');
    const editor = await start(document, deps);
    editor?.commands.setTextSelection(2);
    editor?.view.pasteText('## Overview', clipboard('## Overview', ''));
    expect(editor?.getHTML()).toContain('## Overview');
    expect(editor?.getHTML()).not.toContain('<h2>');
  });
});
