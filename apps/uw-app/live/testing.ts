import type { PresenceQuery } from '@uw/harness';
import type { HubNamespace } from '../env.ts';
import {
  createHubCore,
  hubFetch,
  type HubSocket,
  type HubState,
  type HubTimers,
} from './hub-core.ts';

export type FakeSocket = HubSocket & {
  readonly sent: string[];
  readonly closed: [number, string][];
};

export type FakeHubState = HubState & {
  readonly stored: Map<string, string>;
  alarm(): number | null;
};

export type ManualTimers = HubTimers & { runAll(): Promise<void> };

export const wakeInstant = new Date('2026-10-03T12:00:00.000Z');

export const socketOwner = 'b3000000-0000-4000-8000-0000000000aa';

export function fakeSocket(
  failing = false,
  tag: unknown = { openedAt: wakeInstant.getTime(), person: socketOwner },
): FakeSocket {
  const sent: string[] = [];
  const closed: [number, string][] = [];
  let attachment: unknown = tag;
  let readyState = 1;
  return {
    sent,
    closed,
    get readyState() {
      return readyState;
    },
    send: (message) => {
      if (failing) throw new Error('socket closed');
      sent.push(message);
    },
    close: (code, reason) => {
      closed.push([code, reason]);
      readyState = 3;
    },
    serializeAttachment: (value) => {
      attachment = structuredClone(value);
    },
    deserializeAttachment: () => attachment,
  };
}

export function fakeHubState(sockets: HubSocket[] = []): FakeHubState {
  const stored = new Map<string, string>();
  let alarm: number | null = null;
  return {
    stored,
    alarm: () => alarm,
    acceptWebSocket: (socket) => {
      sockets.push(socket);
    },
    getWebSockets: () => sockets,
    storage: {
      get: async (key) => stored.get(key),
      put: async (key, value) => {
        stored.set(key, value);
      },
      getAlarm: async () => alarm,
      setAlarm: async (scheduledTime) => {
        alarm = scheduledTime;
      },
    },
  };
}

export function manualTimers(): ManualTimers {
  const queued: (() => void)[] = [];
  return {
    setTimeout: (run) => queued.push(run),
    runAll: async () => {
      for (const run of queued.splice(0)) run();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

type FakeHub = {
  readonly served: (request: Request) => Promise<Response>;
  readonly sockets: FakeSocket[];
};

export type FakeHubNamespace = {
  readonly namespace: HubNamespace;
  sent(): string[];
  enter(query: PresenceQuery): void;
};

export function fakeHubNamespace(): FakeHubNamespace {
  const hubs = new Map<string, FakeHub>();
  const hubNamed = (name: string): FakeHub => {
    const known = hubs.get(name);
    if (known !== undefined) return known;
    const sockets = [fakeSocket()];
    const state = fakeHubState(sockets);
    const core = createHubCore(state, { setTimeout }, () => wakeInstant);
    const hub = { served: (request: Request) => hubFetch(core, state, request), sockets };
    hubs.set(name, hub);
    return hub;
  };
  return {
    namespace: {
      idFromName: (name) => name,
      get: (id) => ({
        fetch: (input, init) => hubNamed(String(id)).served(new Request(input, init)),
      }),
    },
    sent: () => [...hubs.values()].flatMap((hub) => hub.sockets[0]?.sent ?? []),
    enter: (query) => {
      const { personId: person, screen, itemId } = query;
      const tag = { openedAt: wakeInstant.getTime(), person, screen, itemId };
      hubNamed(query.harnessId).sockets.push(fakeSocket(false, tag));
    },
  };
}
