import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs';
import { markdownFromEditor } from './from-editor.ts';

type Module = typeof import('./collaboration.ts');
type Core = typeof import('@tiptap/core');
type Extensions = typeof import('./extensions.ts');
type Editor = InstanceType<Core['Editor']>;
type Link = import('./collaboration.ts').Link;

let collab: Module;
let core: Core;
let pageExtensions: Extensions['pageExtensions'];
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

const MARKDOWN = '## Rules\n\nUse **strong** passwords.';
const HTML = '<h2>Rules</h2><p>Use <strong>strong</strong> passwords.</p>';
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
  return { connect, tell: (message: string) => seats.forEach((seat) => seat.say(message)) };
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

async function join(root: HTMLElement, connect: (doc: Doc) => Link) {
  const shared = collab.collaborationFor(root, connect, never);
  if (shared === null) throw new Error('no room on this screen');
  const editor: Editor = new core.Editor({
    element: root.querySelector('[data-editor-surface]'),
    injectCSS: false,
    extensions: [...pageExtensions({ history: false }), ...shared.extensions],
  });
  return { editor, how: await shared.ready(editor, HTML) };
}

function words(root: HTMLElement, selector: string): string {
  return root.closest('form')?.querySelector(selector)?.textContent ?? '';
}

beforeAll(async () => {
  dom = new JSDOM('<!DOCTYPE html><body></body>', {
    url: 'https://uw.example/',
    pretendToBeVisual: true,
  });
  for (const name of globals) {
    Object.defineProperty(globalThis, name, {
      value: name === 'window' ? dom.window : Reflect.get(dom.window, name),
      configurable: true,
      writable: true,
    });
  }
  collab = await import('./collaboration.ts');
  core = await import('@tiptap/core');
  pageExtensions = (await import('./extensions.ts')).pageExtensions;
});

describe('#175 two people who open the same version at once get one copy of the page', () => {
  it('builds the same first content byte for byte, so applying it twice changes nothing', () => {
    const schema = core.getSchema(pageExtensions({ history: false }));
    const first = collab.seedUpdate(schema, HTML);
    expect([...collab.seedUpdate(schema, HTML)]).toEqual([...first]);
    const once = new Doc();
    applyUpdate(once, first);
    const twice = new Doc();
    applyUpdate(twice, first);
    applyUpdate(twice, collab.seedUpdate(schema, HTML));
    expect([...encodeStateAsUpdate(twice)]).toEqual([...encodeStateAsUpdate(once)]);
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
  expect(markdownFromEditor(first.editor.getHTML())).toBe(MARKDOWN);
  expect(markdownFromEditor(second.editor.getHTML())).toBe(MARKDOWN);
  first.editor.commands.insertContentAt(first.editor.state.doc.content.size, '<p>From Ana.</p>');
  expect(markdownFromEditor(second.editor.getHTML())).toBe(`${MARKDOWN}\n\nFrom Ana.`);
  expect(words(ben, '[data-editor-people]')).toBe('Also editing: ana@uw.example.');
  expect(words(ana, '[data-editor-people]')).toBe('Also editing: ben@uw.example.');
}

async function continuesADraft(): Promise<void> {
  const shared = room();
  const ana = seatFor('ana@uw.example');
  const first = await join(ana, shared.connect);
  first.editor.commands.insertContentAt(first.editor.state.doc.content.size, '<p>Unsaved.</p>');
  const ben = seatFor('ben@uw.example');
  const second = await join(ben, shared.connect);
  expect(second.how).toBe('joined');
  expect(words(ben, '[data-editor-status]')).toBe(
    'You are continuing an unsaved draft of this page.',
  );
  expect(markdownFromEditor(second.editor.getHTML())).toBe(`${MARKDOWN}\n\nUnsaved.`);
}

async function discardsForEveryone(): Promise<void> {
  const shared = room();
  const ana = seatFor('ana@uw.example');
  const ben = seatFor('ben@uw.example');
  const first = await join(ana, shared.connect);
  const second = await join(ben, shared.connect);
  second.editor.commands.insertContentAt(second.editor.state.doc.content.size, '<p>Oops.</p>');
  const discard = ana.querySelector<HTMLButtonElement>('[data-editor-discard]');
  expect(discard?.hidden).toBe(false);
  asked.length = 0;
  answers.push(false);
  discard?.click();
  expect(asked).toEqual([collab.discardQuestion(1)]);
  expect(asked[0]).toContain('1 other person is editing this draft');
  expect(markdownFromEditor(second.editor.getHTML())).toBe(`${MARKDOWN}\n\nOops.`);
  answers.push(true);
  discard?.click();
  expect(markdownFromEditor(first.editor.getHTML())).toBe(MARKDOWN);
  expect(markdownFromEditor(second.editor.getHTML())).toBe(MARKDOWN);
  expect(words(ana, '[data-editor-status]')).toContain('Draft discarded');
  const late = await join(seatFor('cy@uw.example'), shared.connect);
  expect(late.how).toBe('joined');
  expect(markdownFromEditor(late.editor.getHTML())).toBe(MARKDOWN);
}

async function stopsWhenSaved(): Promise<void> {
  const shared = room();
  const ana = seatFor('ana@uw.example');
  const first = await join(ana, shared.connect);
  shared.tell('saved');
  expect(first.editor.isEditable).toBe(false);
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
  const editor = new core.Editor({
    element: root.querySelector('[data-editor-surface]'),
    injectCSS: false,
    extensions: [...pageExtensions({ history: false }), ...(shared?.extensions ?? [])],
  });
  expect(await shared?.ready(editor, HTML)).toBe('unavailable');
}

describe('#175 a draft is shared, and nothing changes for readers until someone saves', () => {
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
