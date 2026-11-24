import type { CrepeBuilder } from '@milkdown/crepe/builder';
import { editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import { beforeAll, describe, expect, it } from 'vitest';
import { page, deps, submit, typeText, press, tick, PAGE_ID, win } from './editor-fixture.ts';
import { installDom } from './test-dom.ts';

type Start = typeof import('./page-editor.ts').startPageEditor;

let start: Start;
let slash: typeof import('./slash-items.ts');
let imageBlock: typeof import('@milkdown/kit/component/image-block');

beforeAll(async () => {
  installDom('<!DOCTYPE html><body></body>');
  start = (await import('./page-editor.ts')).startPageEditor;
  slash = await import('./slash-items.ts');
  imageBlock = await import('@milkdown/kit/component/image-block');
});

describe('#175 typing [[ links to a page', () => {
  it('offers matching pages and links the chosen one by its address', async () => {
    const document = page('');
    const editor = await start(document, deps);
    await tick();
    typeText(editor, '[[trav');
    const menu = document.querySelector('[data-editor-menu]');
    expect(menu?.hasAttribute('hidden')).toBe(false);
    expect(
      [...(menu?.querySelectorAll('[data-title]') ?? [])].map((row) => row.textContent),
    ).toEqual(['Travel Policy', 'Embed Travel Policy']);
    press(editor, 'Enter');
    expect(menu?.hasAttribute('hidden')).toBe(true);
    expect(submit(document).trim()).toBe(`[Travel Policy](/pages/${PAGE_ID})`);
  });

  it('embeds the chosen page as wiki syntax', async () => {
    const document = page('');
    const editor = await start(document, deps);
    await tick();
    typeText(editor, '[[trav');
    const rows = document.querySelectorAll('[data-editor-menu] [role="option"]');
    rows[1]?.dispatchEvent(new (win().MouseEvent)('mousedown', { bubbles: true }));
    expect(submit(document).trim()).toBe('![[01.47]]');
  });

  it('leaves wiki syntax typed inside inline code as code', async () => {
    const document = page('Type `see x` to link.');
    const editor = await start(document, deps);
    editor?.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 10)));
    });
    typeText(editor, '[[Page]]');
    expect(submit(document).trim()).toBe('Type `see [[Page]]x` to link.');
  });

  it('keeps a wiki link typed by hand', async () => {
    const document = page('');
    const editor = await start(document, deps);
    typeText(editor, 'Read [[Travel Policy]]');
    expect(document.querySelector('[data-editor-surface] [data-wiki-text]')?.textContent).toBe(
      '[[Travel Policy]]',
    );
    expect(submit(document).trim()).toBe('Read [[Travel Policy]]');
  });
});

describe('the page items in the / menu replace what was typed to find them', () => {
  function run(editor: CrepeBuilder | null, key: string, picked: () => void): string {
    const item = slash.pageSlashItems(picked).find((entry) => entry.key === key);
    return (
      editor?.editor.action((ctx) => {
        item?.run(ctx);
        return ctx.get(editorViewCtx).state.doc.textContent;
      }) ?? ''
    );
  }

  it('starts a page link where /link was typed', async () => {
    const editor = await start(page(''), deps);
    typeText(editor, '/link');
    expect(run(editor, 'page-link', () => undefined)).toBe('[[');
  });

  it('opens the file picker and leaves nothing of /file behind', async () => {
    const editor = await start(page(''), deps);
    typeText(editor, '/file');
    let picked = 0;
    expect(
      run(editor, 'page-file', () => {
        picked += 1;
      }),
    ).toBe('');
    expect(picked).toBe(1);
  });
});

describe('a page that opens as text uploads through the text field alone', () => {
  it('stores a chosen file once', async () => {
    const puts: string[] = [];
    const counting: Parameters<Start>[1] = {
      ...deps,
      fetch: (input, init) => {
        if (init?.method !== 'PUT') return Promise.resolve(Response.json({ entries: [] }));
        puts.push(String(input));
        const file = { name: 'Notes.pdf', contentType: 'application/pdf', url: '/api/files/n' };
        return Promise.resolve(Response.json({ file }));
      },
    };
    const document = page('Read [](https://example.org/rules) first.');
    expect(await start(document, counting)).toBeNull();
    const { wirePageUpload } = await import('../browser/page-upload.ts');
    wirePageUpload(document, counting);
    const input = document.querySelector<HTMLInputElement>('[data-upload-input]');
    const file = new (win().File)(['x'], 'Notes.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    input?.dispatchEvent(new (win().Event)('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(puts).toHaveLength(1);
  });
});

describe('a refused upload says why', () => {
  const refusing: Parameters<Start>[1] = {
    ...deps,
    fetch: (_input, init) =>
      Promise.resolve(
        init?.method === 'PUT'
          ? Response.json({ status: 'error', reason: 'file_too_large' }, { status: 413 })
          : Response.json({ entries: [] }),
      ),
  };

  it('tells the person when a picture dropped into the editor is not stored', async () => {
    const document = page('Intro.');
    const editor = await start(document, refusing);
    const file = new (win().File)(['x'], 'Huge.png', { type: 'image/png' });
    const sent = editor?.editor.action((ctx) =>
      ctx.get(imageBlock.imageBlockConfig.key).onUpload(file),
    );
    await expect(sent).rejects.toThrow();
    expect(document.querySelector('[data-upload-status]')?.textContent).toBe(
      'Not added: the file is larger than 20 MB.',
    );
  });

  it('tells the person when a file chosen while editing is not stored', async () => {
    const document = page('Intro.');
    await start(document, refusing);
    const input = document.querySelector<HTMLInputElement>('[data-upload-input]');
    const file = new (win().File)(['x'], 'Huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    input?.dispatchEvent(new (win().Event)('change'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector('[data-upload-status]')?.textContent).toBe(
      'Not added: the file is larger than 20 MB.',
    );
  });
});

describe('a file added while editing is saved into the page', () => {
  it('adds the uploaded file where the cursor is', async () => {
    const url = '/api/files/00000000-0000-4000-8000-0000000000a1';
    const storing: Parameters<Start>[1] = {
      ...deps,
      fetch: (_input, init) =>
        Promise.resolve(
          init?.method === 'PUT'
            ? Response.json({ file: { name: 'Budget.pdf', contentType: 'application/pdf', url } })
            : Response.json({ entries: [] }),
        ),
    };
    const document = page('Intro.');
    await start(document, storing);
    const input = document.querySelector<HTMLInputElement>('[data-upload-input]');
    const file = new (win().File)(['%PDF'], 'Budget.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    input?.dispatchEvent(new (win().Event)('change'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(submit(document)).toContain(`[Budget.pdf](${url})`);
    expect(document.querySelector('[data-upload-status]')?.textContent).toBe(
      'Added Budget.pdf. Save the page to keep it.',
    );
  });
});
