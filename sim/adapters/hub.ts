import type { Hub, PresenceQuery } from '@uw/harness';

export type SimHub = Hub & {
  wakes(): readonly string[];
  enter(query: PresenceQuery): void;
  leave(query: PresenceQuery): void;
};

function sessionKey(query: PresenceQuery): string {
  const itemId = query.screen === 'item' ? query.itemId : null;
  return JSON.stringify([query.harnessId, query.personId, query.screen, itemId]);
}

export function createSimHub(): SimHub {
  const wakes: string[] = [];
  const sessions = new Map<string, number>();
  return {
    wake: async (harnessId) => {
      wakes.push(harnessId);
    },
    present: async (query) => (sessions.get(sessionKey(query)) ?? 0) > 0,
    wakes: () => [...wakes],
    enter: (query) => {
      const key = sessionKey(query);
      sessions.set(key, (sessions.get(key) ?? 0) + 1);
    },
    leave: (query) => {
      const key = sessionKey(query);
      const open = (sessions.get(key) ?? 0) - 1;
      if (open > 0) sessions.set(key, open);
      else sessions.delete(key);
    },
  };
}
