import { parserCtx, type Editor } from '@milkdown/kit/core';
import { collab, collabServiceCtx } from '@milkdown/plugin-collab';
import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { replaceAll } from '@milkdown/kit/utils';
import { prosemirrorToYXmlFragment, ySyncPluginKey } from 'y-prosemirror';
import type { Awareness } from 'y-protocols/awareness';
import { applyUpdate, Doc, encodeSnapshot, encodeStateAsUpdate, snapshot } from 'yjs';

export type Room = {
  readonly pageId: string;
  readonly version: number;
  readonly person: string;
};

export type Link = {
  readonly awareness: Awareness;
  onSynced(run: () => void): void;
  onMessage(run: (message: string) => void): void;
  destroy(): void;
};

export type Connect = (doc: Doc, room: Room) => Link;

export type Joined = 'seeded' | 'joined' | 'unavailable';

export type Surface = {
  readonly editor: Editor;
  setReadonly(value: boolean): void;
};

export type Collaboration = {
  readonly plugins: readonly MilkdownPlugin[];
  readonly ready: (surface: Surface, markdown: string) => Promise<Joined>;
  readonly snapshot: () => string;
  readonly destroy: () => void;
};

type Waits = {
  readonly setTimeout: (run: () => void, ms: number) => unknown;
  readonly confirm: (question: string) => boolean;
  readonly currentVersion?: (pageId: string) => Promise<number | null>;
};

const FIELD = 'prosemirror';
const SEED_CLIENT = 1;
const SYNC_WAIT_MS = 4000;

function base64Of(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

export function roomIn(root: HTMLElement): Room | null {
  const version = Number(root.getAttribute('data-draft-version'));
  const pageId = root.getAttribute('data-page') ?? '';
  const person = root.getAttribute('data-person') ?? '';
  if (!Number.isInteger(version) || version < 1 || pageId === '') return null;
  return { pageId, version, person };
}

export function seedUpdate(editor: Editor, markdown: string): Uint8Array {
  const node = editor.action((ctx) => ctx.get(parserCtx)(markdown));
  const seed = new Doc();
  seed.clientID = SEED_CLIENT;
  seed.transact(() => {
    prosemirrorToYXmlFragment(node, seed.getXmlFragment(FIELD));
    seed.getMap('meta').set('seeded', true);
  });
  return encodeStateAsUpdate(seed);
}

function caret(user: { readonly name?: unknown }): HTMLElement {
  const mark = document.createElement('span');
  mark.className = 'collab-caret';
  const label = document.createElement('span');
  label.className = 'collab-caret-label';
  label.textContent = typeof user.name === 'string' ? user.name : '';
  mark.append(label);
  return mark;
}

function namesOf(awareness: Awareness): string[] {
  const names: string[] = [];
  for (const [client, state] of awareness.getStates()) {
    const user = (state as { user?: { name?: unknown } }).user;
    if (client !== awareness.clientID && typeof user?.name === 'string') names.push(user.name);
  }
  return [...new Set(names)].sort();
}

function say(root: HTMLElement, selector: string, words: string): void {
  const target = root.closest('form')?.querySelector(selector) ?? null;
  if (target !== null) target.textContent = words;
}

function unshared(root: HTMLElement): void {
  const form = root.closest('form');
  form?.removeAttribute('data-draft-live');
  const mode = form?.querySelector('[data-editor-mode]') ?? null;
  if (mode !== null) mode.textContent = 'Unsaved changes';
}

function showPeople(root: HTMLElement, awareness: Awareness): void {
  const refresh = () => {
    const names = namesOf(awareness);
    say(
      root,
      '[data-editor-people]',
      names.length === 0 ? '' : `Also editing: ${names.join(', ')}.`,
    );
  };
  awareness.on('change', refresh);
  refresh();
}

export function discardQuestion(others: number): string {
  if (others === 0) return 'Throw away this draft and go back to the page as it was last saved?';
  const who = others === 1 ? '1 other person is' : `${String(others)} other people are`;
  return `${who} editing this draft. Discarding throws away their unsaved changes too. Discard it for everyone?`;
}

type Draft = {
  readonly doc: Doc;
  readonly markdown: string;
  readonly link: Link;
  readonly waits: Waits;
};

const EDITS = ['keydown', 'beforeinput', 'paste', 'drop', 'cut', 'pointerdown'] as const;

function markDirtyOnEdits(root: HTMLElement, doc: Doc): void {
  const meta = doc.getMap('meta');
  let touched = false;
  for (const kind of EDITS) {
    root.addEventListener(
      kind,
      () => {
        touched = true;
      },
      { capture: true },
    );
  }
  (root.closest('form') ?? root).addEventListener(
    'change',
    (event) => {
      if (event.target instanceof Element && event.target.matches('[data-upload-input]')) {
        touched = true;
      }
    },
    { capture: true },
  );
  doc.on('update', (_update: Uint8Array, origin: unknown) => {
    if (touched && origin === ySyncPluginKey && meta.get('dirty') !== true) meta.set('dirty', true);
  });
}

function wireDraft(root: HTMLElement, surface: Surface, draft: Draft): void {
  const { doc, markdown } = draft;
  const meta = doc.getMap('meta');
  markDirtyOnEdits(root, doc);
  const scope = root.closest('form') ?? root;
  const discard = scope.querySelector<HTMLButtonElement>('[data-editor-discard]');
  if (discard === null) return;
  discard.hidden = false;
  discard.addEventListener('click', () => {
    const others = namesOf(draft.link.awareness).length;
    if (!draft.waits.confirm(discardQuestion(others))) return;
    surface.editor.action(replaceAll(markdown));
    meta.set('dirty', false);
    say(root, '[data-editor-status]', 'Draft discarded. The page is as it was last saved.');
  });
}

function whenSynced(link: Link, waits: Waits): Promise<boolean> {
  return new Promise((resolve) => {
    link.onSynced(() => resolve(true));
    waits.setTimeout(() => resolve(false), SYNC_WAIT_MS);
  });
}

const WATCH_MS = 30_000;
const SUPERSEDED =
  'A newer version of this page was saved somewhere else. Your draft is still here, but it cannot be saved over the newer version: copy what you need, then open the page.';

export function watchVersion(root: HTMLElement, room: Room, waits: Waits): void {
  const current = waits.currentVersion;
  if (current === undefined) return;
  const check = (): void => {
    void current(room.pageId)
      .then((version) => {
        if (version !== null && version > room.version) {
          say(root, '[data-editor-status]', SUPERSEDED);
          unshared(root);
          return;
        }
        waits.setTimeout(check, WATCH_MS);
      })
      .catch(() => waits.setTimeout(check, WATCH_MS));
  };
  waits.setTimeout(check, WATCH_MS);
}

const SAVED_BEHIND =
  'Someone saved a new version, but your latest changes were not in it. They are still here: copy them, then open the page.';

function heard(root: HTMLElement, surface: Surface, link: Link, message: string): void {
  if (message === 'saved-behind') {
    say(root, '[data-editor-status]', SAVED_BEHIND);
    unshared(root);
    return;
  }
  if (message !== 'saved') return;
  surface.setReadonly(true);
  link.destroy();
  say(
    root,
    '[data-editor-status]',
    'This draft was saved as a new version. Open the page to carry on from it.',
  );
}

function bind(surface: Surface, doc: Doc, link: Link, room: Room): void {
  link.awareness.setLocalStateField('user', { name: room.person });
  surface.editor.action((ctx) => {
    ctx
      .get(collabServiceCtx)
      .bindDoc(doc)
      .setAwareness(link.awareness)
      .setOptions({
        yCursorOpts: {
          cursorBuilder: caret,
          selectionBuilder: () => ({ class: 'collab-selection' }),
        },
      })
      .connect();
  });
}

function joining(root: HTMLElement, parts: Omit<Draft, 'markdown'> & { readonly room: Room }) {
  const { doc, link, waits, room } = parts;
  return async (surface: Surface, markdown: string): Promise<Joined> => {
    if (!(await whenSynced(link, waits))) return 'unavailable';
    const meta = doc.getMap('meta');
    const seeded = meta.get('seeded') === true;
    if (!seeded) applyUpdate(doc, seedUpdate(surface.editor, markdown));
    bind(surface, doc, link, room);
    wireDraft(root, surface, { doc, markdown, link, waits });
    showPeople(root, link.awareness);
    watchVersion(root, room, waits);
    link.onMessage((message) => {
      heard(root, surface, link, message);
    });
    if (seeded && meta.get('dirty') === true) {
      say(root, '[data-editor-status]', 'You are continuing an unsaved draft of this page.');
    }
    return seeded ? 'joined' : 'seeded';
  };
}

export function collaborationFor(
  root: HTMLElement,
  connect: Connect,
  waits: Waits,
): Collaboration | null {
  const room = roomIn(root);
  if (room === null) return null;
  const doc = new Doc();
  const link = connect(doc, room);
  return {
    plugins: [collab],
    ready: joining(root, { doc, link, waits, room }),
    snapshot: () => base64Of(encodeSnapshot(snapshot(doc))),
    destroy: () => {
      link.destroy();
      doc.destroy();
    },
  };
}
