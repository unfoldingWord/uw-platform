import type { CrepeBuilder } from '@milkdown/crepe/builder';
import { editorViewCtx } from '@milkdown/kit/core';
import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs';
import { installDom } from './test-dom.ts';

type Module = typeof import('./collaboration.ts');
type Builder = typeof import('./crepe-editor.ts');
type Link = import('./collaboration.ts').Link;

let collab: Module;
let builder: Builder;

const MAC = /Mac|iP(hone|[oa]d)/.test(globalThis.navigator.platform);
const MARKDOWN = '## Rules\n\nUse **strong** passwords.';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const asked: string[] = [];
const answers: boolean[] = [];
const never = {
  setTimeout: () => undefined,
  confirm: (question: string) => {
    asked.push(question);
    return answers.shift() ?? true;
  },
};

type Seat = { readonly doc: Doc; readonly awareness: Awareness; say: (message: string) => void };

function room() {
  const server = new Doc();
  const seats: Seat[] = [];
  const connect = (doc: Doc): Link => {
    const awareness = new Awareness(doc);
    const heard: ((message: string) => void)[] = [];
    const seat: Seat = { doc, awareness, say: (message) => heard.forEach((run) => run(message)) };
    seats.push(seat);
    doc.on('update', (update: Uint8Array) => {
      applyUpdate(server, update);
      for (const other of seats) if (other !== seat) applyUpdate(other.doc, update);
    });
    awareness.on('update', (changed: { added: number[]; updated: number[]; removed: number[] }) => {
      const clients = [...changed.added, ...changed.updated, ...changed.removed];
      const update = encodeAwarenessUpdate(awareness, clients);
      for (const other of seats) {
        if (other !== seat) applyAwarenessUpdate(other.awareness, update, 'room');
      }
    });
    return {
      awareness,
      onSynced: (run) => {
        applyUpdate(doc, encodeStateAsUpdate(server));
        for (const other of seats) {
          if (other === seat) continue;
          const known = encodeAwarenessUpdate(other.awareness, [other.awareness.clientID]);
          applyAwarenessUpdate(awareness, known, 'room');
        }
        void tick().then(run);
      },
      onMessage: (run) => heard.push(run),
      destroy: () => undefined,
    };
  };
  return {
    connect,
    seats,
    tell: (message: string) => seats.forEach((seat) => seat.say(message)),
  };
}

function seatFor(person: string): HTMLElement {
  const form = document.createElement('form');
  form.innerHTML = `<div data-editor data-page="p1" data-draft-version="3" data-person="${person}">
      <div data-editor-surface></div>
      <button type="button" data-editor-discard hidden>Discard draft</button>
    </div>
    <p data-editor-people></p><p data-editor-status></p>`;
  document.body.append(form);
  return form.querySelector<HTMLElement>('[data-editor]') as HTMLElement;
}

async function editorIn(
  root: HTMLElement,
  plugins: readonly MilkdownPlugin[],
): Promise<CrepeBuilder> {
  const editor = builder.pageEditor({
    root: root.querySelector<HTMLElement>('[data-editor-surface]') ?? root,
    markdown: MARKDOWN,
    upload: () => Promise.resolve(''),
    slashItems: [],
    plugins,
  });
  if (plugins.length > 0) await builder.sharedHistory(editor);
  await editor.create();
  return editor;
}

function surfaceOf(editor: CrepeBuilder) {
  return { editor: editor.editor, setReadonly: (value: boolean) => editor.setReadonly(value) };
}

async function join(root: HTMLElement, connect: (doc: Doc) => Link) {
  const shared = collab.collaborationFor(root, connect, never);
  if (shared === null) throw new Error('no room on this screen');
  const editor = await editorIn(root, shared.plugins);
  return { editor, how: await shared.ready(surfaceOf(editor), MARKDOWN) };
}

function touch(editor: CrepeBuilder): void {
  editor.editor.action((ctx) => {
    ctx
      .get(editorViewCtx)
      .dom.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
  });
}

function undo(editor: CrepeBuilder): void {
  editor.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const event = new KeyboardEvent('keydown', { key: 'z', metaKey: MAC, ctrlKey: !MAC });
    view.someProp('handleKeyDown', (handle) => handle(view, event));
  });
}

function append(editor: CrepeBuilder, words: string): void {
  touch(editor);
  editor.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const { schema, doc } = view.state;
    const paragraph = schema.nodes['paragraph']?.create(null, schema.text(words));
    if (paragraph !== undefined) view.dispatch(view.state.tr.insert(doc.content.size, paragraph));
  });
}

function shown(editor: CrepeBuilder): string {
  return editor.getMarkdown().trim();
}

function words(root: HTMLElement, selector: string): string {
  return root.closest('form')?.querySelector(selector)?.textContent ?? '';
}

beforeAll(async () => {
  installDom('<!DOCTYPE html><body></body>');
  collab = await import('./collaboration.ts');
  builder = await import('./crepe-editor.ts');
});

describe('#175 two people who open the same version at once get one copy of the page', () => {
  it('builds the same first content byte for byte, so applying it twice changes nothing', async () => {
    const editor = await editorIn(document.body, []);
    const first = collab.seedUpdate(editor.editor, MARKDOWN);
    expect([...collab.seedUpdate(editor.editor, MARKDOWN)]).toEqual([...first]);
    const once = new Doc();
    applyUpdate(once, first);
    const twice = new Doc();
    applyUpdate(twice, first);
    applyUpdate(twice, collab.seedUpdate(editor.editor, MARKDOWN));
    expect([...encodeStateAsUpdate(twice)]).toEqual([...encodeStateAsUpdate(once)]);
    await editor.destroy();
  });

  it('reads no room from a screen that offers none', () => {
    const root = document.createElement('div');
    root.setAttribute('data-page', 'p1');
    expect(collab.roomIn(root)).toBeNull();
    expect(collab.collaborationFor(root, room().connect, never)).toBeNull();
  });
});

async function seedsThenJoins(): Promise<void> {
  const shared = room();
  const ana = seatFor('ana@uw.example');
  const ben = seatFor('ben@uw.example');
  const first = await join(ana, shared.connect);
  const second = await join(ben, shared.connect);
  expect([first.how, second.how]).toEqual(['seeded', 'joined']);
  expect(shown(first.editor)).toBe(MARKDOWN);
  expect(shown(second.editor)).toBe(MARKDOWN);
  append(first.editor, 'From Ana.');
  expect(shown(second.editor)).toBe(`${MARKDOWN}\n\nFrom Ana.`);
  expect(words(ben, '[data-editor-people]')).toBe('Also editing: ana@uw.example.');
  expect(words(ana, '[data-editor-people]')).toBe('Also editing: ben@uw.example.');
}

async function continuesADraft(): Promise<void> {
  const shared = room();
  const ana = seatFor('ana@uw.example');
  const first = await join(ana, shared.connect);
  append(first.editor, 'Unsaved.');
  const ben = seatFor('ben@uw.example');
  const second = await join(ben, shared.connect);
  expect(second.how).toBe('joined');
  expect(words(ben, '[data-editor-status]')).toBe(
    'You are continuing an unsaved draft of this page.',
  );
  expect(shown(second.editor)).toBe(`${MARKDOWN}\n\nUnsaved.`);
}

async function discardsForEveryone(): Promise<void> {
  const shared = room();
  const ana = seatFor('ana@uw.example');
  const ben = seatFor('ben@uw.example');
  const first = await join(ana, shared.connect);
  const second = await join(ben, shared.connect);
  append(second.editor, 'Oops.');
  const discard = ana.querySelector<HTMLButtonElement>('[data-editor-discard]');
  expect(discard?.hidden).toBe(false);
  asked.length = 0;
  answers.push(false);
  discard?.click();
  expect(asked).toEqual([collab.discardQuestion(1)]);
  expect(asked[0]).toContain('1 other person is editing this draft');
  expect(shown(second.editor)).toBe(`${MARKDOWN}\n\nOops.`);
  answers.push(true);
  discard?.click();
  expect(shown(first.editor)).toBe(MARKDOWN);
  expect(shown(second.editor)).toBe(MARKDOWN);
  expect(words(ana, '[data-editor-status]')).toContain('Draft discarded');
  const late = await join(seatFor('cy@uw.example'), shared.connect);
  expect(late.how).toBe('joined');
  expect(shown(late.editor)).toBe(MARKDOWN);
}

async function stopsWhenSaved(): Promise<void> {
  const shared = room();
  const ana = seatFor('ana@uw.example');
  const first = await join(ana, shared.connect);
  shared.tell('saved');
  expect(first.editor.readonly).toBe(true);
  expect(words(ana, '[data-editor-status]')).toContain('saved as a new version');
}

async function reportsUnavailable(): Promise<void> {
  const silent = () => ({
    awareness: new Awareness(new Doc()),
    onSynced: () => undefined,
    onMessage: () => undefined,
    destroy: () => undefined,
  });
  const root = seatFor('ana@uw.example');
  const shared = collab.collaborationFor(root, silent, {
    setTimeout: (run: () => void) => run(),
    confirm: () => true,
  });
  const editor = await editorIn(root, shared?.plugins ?? []);
  expect(await shared?.ready(surfaceOf(editor), MARKDOWN)).toBe('unavailable');
}

async function openingLeavesItClean(): Promise<void> {
  const shared = room();
  await join(seatFor('ana@uw.example'), shared.connect);
  await join(seatFor('ben@uw.example'), shared.connect);
  await tick();
  const meta = shared.seats[0]?.doc.getMap('meta');
  expect(meta?.get('dirty')).not.toBe(true);
}

async function controlsThatStopEventsStillCount(): Promise<void> {
  const shared = room();
  const root = seatFor('ana@uw.example');
  const first = await join(root, shared.connect);
  const control = document.createElement('input');
  control.addEventListener('pointerdown', (event) => event.stopPropagation());
  root.querySelector('[data-editor-surface]')?.append(control);
  control.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  first.editor.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.insertText('Ticked.', 1));
  });
  expect(shared.seats[0]?.doc.getMap('meta').get('dirty')).toBe(true);
}

async function anUploadOutsideTheEditorCounts(): Promise<void> {
  const shared = room();
  const root = seatFor('ana@uw.example');
  const first = await join(root, shared.connect);
  const input = document.createElement('input');
  input.type = 'file';
  input.setAttribute('data-upload-input', '');
  root.closest('form')?.append(input);
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await tick();
  first.editor.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.insertText('![Map](/api/files/f1)', 1));
  });
  expect(shared.seats[0]?.doc.getMap('meta').get('dirty')).toBe(true);
}

async function undoesOnlyYourOwnEdit(): Promise<void> {
  const shared = room();
  const first = await join(seatFor('ana@uw.example'), shared.connect);
  const second = await join(seatFor('ben@uw.example'), shared.connect);
  append(first.editor, 'From Ana.');
  await new Promise((resolve) => setTimeout(resolve, 600));
  append(second.editor, 'From Ben.');
  undo(first.editor);
  expect(shown(first.editor)).toBe(`${MARKDOWN}\n\nFrom Ben.`);
  expect(shown(second.editor)).toBe(`${MARKDOWN}\n\nFrom Ben.`);
}

describe('#175 a draft is shared, and nothing changes for readers until someone saves', () => {
  it('leaves the draft clean when people only open it', openingLeavesItClean);
  it('undoes your own last edit and keeps what others typed', undoesOnlyYourOwnEdit);
  it(
    'counts an edit made through a control that stops its events',
    controlsThatStopEventsStillCount,
  );
  it(
    'counts a file added through the upload control outside the editor',
    anUploadOutsideTheEditorCounts,
  );
  it('seeds the draft for the first person and joins the second to it', seedsThenJoins);
  it('tells a person who joins later that they are continuing a draft', continuesADraft);
  it('discards the draft for everyone, back to the page as it was saved', discardsForEveryone);
  it('stops editing when someone else saves the draft', stopsWhenSaved);
  it('reports that sharing is unavailable when the room never answers', reportsUnavailable);
});

describe('#175 people in a draft are told when a newer version is saved elsewhere', () => {
  it('checks the page every so often and says so once it has moved on', async () => {
    const root = seatFor('ana@uw.example');
    root.closest('form')?.setAttribute('data-draft-live', '');
    const room = collab.roomIn(root);
    if (room === null) throw new Error('no room');
    const pending: (() => void)[] = [];
    const versions = [3, 3, 4];
    collab.watchVersion(root, room, {
      setTimeout: (run: () => void) => pending.push(run),
      confirm: () => true,
      currentVersion: () => Promise.resolve(versions.shift() ?? null),
    });
    for (let round = 0; round < 3; round += 1) {
      pending.shift()?.();
      await tick();
    }
    expect(words(root, '[data-editor-status]')).toContain('A newer version of this page was saved');
    expect(root.closest('form')?.hasAttribute('data-draft-live')).toBe(false);
    expect(pending).toHaveLength(0);
  });
});
