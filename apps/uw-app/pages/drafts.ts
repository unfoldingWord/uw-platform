import { z } from 'zod';
import type { Bindings } from '../env.ts';

const ROOM_URL = 'https://draft.internal/room';

const statusSchema = z.object({ dirty: z.boolean(), editors: z.number().int().min(0) });

type DraftStatus = z.infer<typeof statusSchema>;

export type Drafts = {
  status(pageId: string, version: number): Promise<DraftStatus | null>;
  close(pageId: string, version: number): Promise<void>;
  connect(pageId: string, version: number, connectionId: string): Promise<Response>;
};

function roomOf(pageId: string, version: number): string {
  return `${pageId}.${String(version)}`;
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
    close: async (pageId, version) => {
      try {
        await ask(pageId, version, '', { method: 'POST', headers: {} });
      } catch {
        return;
      }
    },
    connect: (pageId, version, connectionId) =>
      ask(pageId, version, `?_pk=${encodeURIComponent(connectionId)}`, {
        method: 'GET',
        headers: { Upgrade: 'websocket' },
      }),
  };
}
