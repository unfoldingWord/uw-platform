import { describe, expect, it } from 'vitest';
import type { Bindings } from '../env.ts';
import { draftsOf } from './drafts.ts';

const PAGE = '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11';

function asked(): { readonly env: Bindings; readonly rooms: string[] } {
  const rooms: string[] = [];
  const namespace = {
    idFromName: (name: string) => {
      rooms.push(name);
      return name;
    },
    get: () => ({ fetch: () => Promise.resolve(Response.json({ dirty: false, editors: 0 })) }),
  };
  const env: Bindings = { PAGE_DRAFT: namespace };
  return { env, rooms };
}

describe('a working draft is kept in a room of its own editor', () => {
  it('names the room for the page, its version and the Milkdown editor', async () => {
    const { env, rooms } = asked();
    await draftsOf(env)?.status(PAGE, 3);
    expect(rooms).toEqual([`${PAGE}.3.milkdown`]);
  });
});
