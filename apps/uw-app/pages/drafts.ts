import { z } from 'zod';
import type { Bindings } from '../env.ts';

const ROOM_URL = 'https://draft.internal/room';
const EDITOR = 'milkdown';

const statusSchema = z.object({ dirty: z.boolean(), editors: z.number().int().min(0) });

type DraftStatus = z.infer<typeof statusSchema>;

export type Drafts = {
  status(pageId: string, version: number): Promise<DraftStatus | null>;
  close(pageId: string, version: number, saved: string | null): Promise<void>;
  connect(room: Room): Promise<Response>;
};

type Room = {
  readonly pageId: string;
  readonly version: number;
  readonly connectionId: string;
  readonly until: number;
};

function roomOf(pageId: string, version: number): string {
  return `${pageId}.${String(version)}.${EDITOR}`;
}

export function draftsOf(env: Bindings): Drafts | null {
  const namespace = env.PAGE_DRAFT;
  if (namespace === undefined) return null;
  const ask = (pageId: string, version: number, path: string, init: RequestInit) => {
    const room = roomOf(pageId, version);
    const headers = { ...(init.headers as Record<string, string>), 'x-partykit-room': room };
    return namespace.get(namespace.idFromName(room)).fetch(`${ROOM_URL}${path}`, {
      ...init,
      headers,
    });
  };
  return {
    status: async (pageId, version) => {
      try {
        const reply = await ask(pageId, version, '', { method: 'GET', headers: {} });
        return statusSchema.parse(await reply.json());
      } catch {
        return null;
      }
    },
    close: async (pageId, version, saved) => {
      const sent = saved === null ? '' : `?saved=${encodeURIComponent(saved)}`;
      try {
        await ask(pageId, version, sent, { method: 'POST', headers: {} });
      } catch {
        return;
      }
    },
    connect: (room) =>
      ask(room.pageId, room.version, `?_pk=${encodeURIComponent(room.connectionId)}`, {
        method: 'GET',
        headers: { Upgrade: 'websocket', 'x-draft-until': String(room.until) },
      }),
  };
}
