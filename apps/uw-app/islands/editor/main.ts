import YProvider from 'y-partyserver/provider';
import '../browser/jitless.ts';
import { collaborationFor, type Connect } from './collaboration.ts';
import { startPageEditor } from './page-editor.ts';

const connect: Connect = (doc, room) => {
  const provider = new YProvider(
    window.location.host,
    `${room.pageId}.${String(room.version)}`,
    doc,
    {
      prefix: `/api/pages/${room.pageId}/draft`,
      params: { v: String(room.version) },
    },
  );
  return {
    awareness: provider.awareness,
    onSynced: (run) => provider.on('sync', (synced: boolean) => (synced ? run() : undefined)),
    onMessage: (run) => provider.on('custom-message', run),
    destroy: () => provider.destroy(),
  };
};

document.addEventListener('DOMContentLoaded', () => {
  void startPageEditor(document, {
    fetch: (input, init) => window.fetch(input, init),
    uuid: () => crypto.randomUUID(),
    collaboration: (root) => collaborationFor(root, connect, window),
  });
});
