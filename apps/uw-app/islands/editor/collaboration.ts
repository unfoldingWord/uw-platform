import { createNodeFromContent, type Editor, type Extensions } from '@tiptap/core';
import Collaboration, { isChangeOrigin } from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import type { Node as PageNode, Schema } from '@tiptap/pm/model';
import { prosemirrorToYXmlFragment } from '@tiptap/y-tiptap';
import type { Awareness } from 'y-protocols/awareness';
import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs';

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

export type Collaboration = {
  readonly extensions: Extensions;
  readonly ready: (editor: Editor, html: string) => Promise<Joined>;
  readonly destroy: () => void;
};

type Waits = { readonly setTimeout: (run: () => void, ms: number) => unknown };

const FIELD = 'default';
const SEED_CLIENT = 1;
const SYNC_WAIT_MS = 4000;

export function roomIn(root: HTMLElement): Room | null {
  const version = Number(root.getAttribute('data-draft-version'));
  const pageId = root.getAttribute('data-page') ?? '';
  const person = root.getAttribute('data-person') ?? '';
  if (!Number.isInteger(version) || version < 1 || pageId === '') return null;
  return { pageId, version, person };
}

export function seedUpdate(schema: Schema, html: string): Uint8Array {
  const node = createNodeFromContent(html, schema, { slice: false }) as PageNode;
  const seed = new Doc();
  seed.clientID = SEED_CLIENT;
  seed.transact(() => {
    prosemirrorToYXmlFragment(node, seed.getXmlFragment(FIELD));
    seed.getMap('meta').set('seeded', true);
  });
  return encodeStateAsUpdate(seed);
}

function caret(user: Record<string, unknown>): HTMLElement {
  const mark = document.createElement('span');
  mark.className = 'collab-caret';
  const label = document.createElement('span');
  label.className = 'collab-caret-label';
  label.textContent = typeof user['name'] === 'string' ? user['name'] : '';
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

function wireDraft(root: HTMLElement, editor: Editor, doc: Doc, html: string): void {
  const meta = doc.getMap('meta');
  editor.on('update', ({ transaction }) => {
    if (!isChangeOrigin(transaction) && meta.get('dirty') !== true) meta.set('dirty', true);
  });
  const discard = root.querySelector<HTMLButtonElement>('[data-editor-discard]');
  if (discard === null) return;
  discard.hidden = false;
  discard.addEventListener('click', () => {
    editor.commands.setContent(html);
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

export function collaborationFor(
  root: HTMLElement,
  connect: Connect,
  waits: Waits,
): Collaboration | null {
  const room = roomIn(root);
  if (room === null) return null;
  const doc = new Doc();
  const link = connect(doc, room);
  const destroy = () => {
    link.destroy();
    doc.destroy();
  };
  return {
    extensions: [
      Collaboration.configure({ document: doc, field: FIELD }),
      CollaborationCaret.configure({
        provider: { awareness: link.awareness },
        user: { name: room.person },
        render: caret,
        selectionRender: () => ({ nodeName: 'span', class: 'collab-selection' }),
      }),
    ],
    ready: async (editor, html) => {
      if (!(await whenSynced(link, waits))) return 'unavailable';
      const meta = doc.getMap('meta');
      const seeded = meta.get('seeded') === true;
      if (!seeded) applyUpdate(doc, seedUpdate(editor.schema, html));
      wireDraft(root, editor, doc, html);
      showPeople(root, link.awareness);
      link.onMessage((message) => {
        if (message !== 'saved') return;
        editor.setEditable(false);
        link.destroy();
        say(
          root,
          '[data-editor-status]',
          'This draft was saved as a new version. Open the page to carry on from it.',
        );
      });
      if (seeded && meta.get('dirty') === true) {
        say(root, '[data-editor-status]', 'You are continuing an unsaved draft of this page.');
      }
      return seeded ? 'joined' : 'seeded';
    },
    destroy,
  };
}
