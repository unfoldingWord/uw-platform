import { editorViewCtx, schemaCtx } from '@milkdown/kit/core';
import { DOMSerializer } from '@milkdown/kit/prose/model';
import { insert } from '@milkdown/kit/utils';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  page,
  deps,
  submitted,
  submit,
  typeText,
  press,
  pendingDraft,
  saveButton,
  paste,
  RULES,
} from './editor-fixture.ts';
import { installDom } from './test-dom.ts';

type Start = typeof import('./page-editor.ts').startPageEditor;

let start: Start;
let codeBlock: typeof import('@milkdown/kit/component/code-block');
let codeMirror: {
  readonly state: typeof import('@codemirror/state');
  readonly view: typeof import('@codemirror/view');
};

beforeAll(async () => {
  installDom('<!DOCTYPE html><body></body>');
  start = (await import('./page-editor.ts')).startPageEditor;
  codeBlock = await import('@milkdown/kit/component/code-block');
  codeMirror = { state: await import('@codemirror/state'), view: await import('@codemirror/view') };
});

describe('#175 the editor takes over the text field, and hands markdown back on save', () => {
  it('shows the editor, hides the text field, and saves the page unchanged when nothing was typed', async () => {
    const markdown = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const document = page(markdown);
    const editor = await start(document, deps);
    expect(editor).not.toBeNull();
    expect(document.querySelector('[data-editor]')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('[data-editor-text]')?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('[data-editor-surface] .milkdown')).not.toBeNull();
    expect(submit(document)).toBe(markdown);
  });

  it('writes what was typed as markdown', async () => {
    const document = page('');
    const editor = await start(document, deps);
    editor?.editor.action(insert('## Second\n\nWith **bold**.'));
    expect(submit(document)).toBe('## Second\n\nWith **bold**.\n');
  });

  it('opens as text, and says why, when the editor would change what the page means', async () => {
    const lossy = 'Read [](https://example.org/rules) first.';
    const document = page(lossy);
    const editor = await start(document, deps);
    expect(editor?.getMarkdown() ?? null).toBeNull();
    expect(document.querySelector('[data-editor]')?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('[data-editor-text]')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('[data-editor-status]')?.textContent).toContain('opens as text');
    expect(document.querySelector('[data-editor-mode]')?.textContent).toBe('Editing on your own');
    expect(submit(document)).toBe(lossy);
  });

  it('does nothing on a screen with no editor', async () => {
    const document = installDom('<!DOCTYPE html><body><form></form></body>').window.document;
    expect(await start(document, deps)).toBeNull();
  });
});

describe('table cells show their alignment without inline styles', () => {
  it('draws an aligned cell with data-align, reads it back, and keeps it in the markdown', async () => {
    const markdown = '| Left | Middle |\n| :--- | :----: |\n| a    |    b   |';
    const document = page(markdown);
    const editor = await start(document, deps);
    const drawn = editor?.editor.action((ctx) => {
      const schema = ctx.get(schemaCtx);
      const cell = schema.nodes['table_cell']?.createAndFill({ alignment: 'center' });
      const serializer = DOMSerializer.fromSchema(schema);
      const dom = cell === undefined || cell === null ? null : serializer.serializeNode(cell);
      const back = document.createElement('td');
      back.setAttribute('data-align', 'right');
      const rule = schema.nodes['table_cell']?.spec.parseDOM?.[0];
      const read = rule !== undefined && 'getAttrs' in rule ? rule.getAttrs?.(back as never) : null;
      return { dom: dom as HTMLElement | null, read };
    });
    expect(drawn?.dom?.getAttribute('data-align')).toBe('center');
    expect(drawn?.dom?.hasAttribute('style')).toBe(false);
    expect(drawn?.read).toMatchObject({ alignment: 'right' });
    expect(submit(document)).toBe(markdown);
  });
});

describe('a table copied out of the editor keeps its alignment', () => {
  it('writes the alignment as a style only on the clipboard', async () => {
    const editor = await start(page('| A |\n| :-: |\n| b |'), deps);
    const copied = editor?.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const serializer = view.someProp('clipboardSerializer');
      const cell = view.state.schema.nodes['table_cell']?.createAndFill({ alignment: 'center' });
      if (serializer === undefined || cell === null || cell === undefined) return null;
      return serializer.serializeNode(cell) as HTMLElement;
    });
    expect(copied?.getAttribute('style')).toMatch(/^text-align: center;?$/);
  });
});

describe("code blocks style themselves under the page's style nonce", () => {
  it('hands the nonce from the edit screen to the code editor', async () => {
    const document = page('```js\nlet a = 1;\n```');
    const editor = await start(document, deps);
    const nonce = editor?.editor.action((ctx) =>
      codeMirror.state.EditorState.create({
        extensions: ctx.get(codeBlock.codeBlockConfig.key).extensions,
      }).facet(codeMirror.view.EditorView.cspNonce),
    );
    expect(nonce).toBe('bm9uY2U=');
  });
});

describe('#175 nothing is typed or saved until the shared draft is ready', () => {
  it('holds Save and typing while joining, then saves the draft with its state', async () => {
    const document = page(RULES);
    const draft = pendingDraft();
    const started = start(document, { ...deps, collaboration: () => draft.shared });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(saveButton(document)?.disabled).toBe(true);
    expect(document.querySelector('[contenteditable]')?.getAttribute('contenteditable')).toBe(
      'false',
    );
    expect(submitted(document).sent).toBe(false);
    draft.answer('joined');
    const editor = await started;
    expect(saveButton(document)?.disabled).toBe(false);
    expect(editor?.readonly).toBe(false);
    expect(document.querySelector('form')?.hasAttribute('data-draft-live')).toBe(true);
    expect(document.querySelector('[data-editor-mode]')?.textContent).toBe('Working draft');
    editor?.editor.action(insert('Joined.'));
    const saved = submitted(document);
    expect(saved.sent).toBe(true);
    expect(saved.body).toContain('Joined.');
    expect(document.querySelector<HTMLInputElement>('input[name="draftState"]')?.value).toBe(
      'c25hcHNob3Q=',
    );
  });

  it('edits alone from the saved text when the shared draft never answers', async () => {
    const document = page(RULES);
    const draft = pendingDraft();
    const started = start(document, { ...deps, collaboration: () => draft.shared });
    draft.answer('unavailable');
    const editor = await started;
    expect(draft.destroyed()).toBe(true);
    expect(editor?.readonly).toBe(false);
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

describe('#175 editing alone after the shared draft fails keeps undo', () => {
  it('keeps its own undo when it edits alone after the shared draft never answers', async () => {
    const document = page(RULES);
    const draft = pendingDraft();
    const started = start(document, { ...deps, collaboration: () => draft.shared });
    draft.answer('unavailable');
    const editor = await started;
    typeText(editor, 'x');
    press(editor, 'z', true);
    expect(submit(document)).toBe(RULES);
  });
});

const PASTED = [
  '> Pro Tip: search this page.',
  '## Overview',
  'unfoldingWord uses [Johnny.Decimal](https://johnnydecimal.com/) for **knowledge**.',
  '- Areas\n- Categories',
].join('\n\n');

describe('pasting markdown keeps its formatting', () => {
  it('turns pasted markdown text into headings, quotes, links and lists', async () => {
    const document = page('');
    const editor = await start(document, deps);
    paste(editor, PASTED);
    const surface = document.querySelector('[data-editor-surface]');
    expect(surface?.querySelector('h2')?.textContent).toBe('Overview');
    expect(surface?.querySelector('blockquote')).not.toBeNull();
    expect(surface?.querySelector('a[href="https://johnnydecimal.com/"]')).not.toBeNull();
    expect(submit(document).trim()).toBe(PASTED);
  });

  it('keeps formatted text copied from a web page as it was', async () => {
    const document = page('');
    const editor = await start(document, deps);
    const html = '<p><strong>Bold</strong> # not a heading</p>';
    paste(editor, '**Bold** # not a heading', html);
    expect(submit(document).trim()).toBe('**Bold** # not a heading');
  });
});
