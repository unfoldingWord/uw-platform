import type { DraftNamespace } from '../env.ts';

type DraftCall = {
  readonly room: string;
  readonly method: string;
  readonly socket: boolean;
  readonly url: string;
};

export type MemoryDrafts = { readonly namespace: DraftNamespace; readonly calls: DraftCall[] };

export function memoryDrafts(dirtyRooms: readonly string[] = []): MemoryDrafts {
  const calls: DraftCall[] = [];
  const namespace: DraftNamespace = {
    idFromName: (name) => name,
    get: (id) => ({
      fetch: async (url, init) => {
        const headers = new Headers(init?.headers);
        const room = String(id);
        const socket = headers.get('upgrade') === 'websocket';
        calls.push({ room, method: init?.method ?? 'GET', socket, url });
        if (socket) return new Response('joined');
        const dirty = dirtyRooms.includes(room) && init?.method !== 'POST';
        return Response.json({ dirty, editors: dirty ? 1 : 0 });
      },
    }),
  };
  return { namespace, calls };
}
