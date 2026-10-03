import type { HubNamespace } from '../env.ts';
import {
  createHubCore,
  hubFetch,
  type HubSocket,
  type HubState,
  type HubTimers,
} from './hub-core.ts';

export type FakeSocket = HubSocket & { readonly sent: string[] };

export type FakeHubState = HubState & { readonly stored: Map<string, string> };

export type ManualTimers = HubTimers & { runAll(): Promise<void> };

export const wakeInstant = new Date('2026-10-03T12:00:00.000Z');

export function fakeSocket(failing = false): FakeSocket {
  const sent: string[] = [];
  return {
    sent,
    send: (message) => {
      if (failing) throw new Error('socket closed');
      sent.push(message);
    },
  };
}

export function fakeHubState(sockets: HubSocket[] = []): FakeHubState {
  const stored = new Map<string, string>();
  return {
    stored,
    acceptWebSocket: (socket) => {
      sockets.push(socket);
    },
    getWebSockets: () => sockets,
    storage: {
      get: async (key) => stored.get(key),
      put: async (key, value) => {
        stored.set(key, value);
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

export function fakeHubNamespace(): { readonly namespace: HubNamespace; sent(): string[] } {
  const sockets = new Map<string, FakeSocket>();
  const hubs = new Map<string, (request: Request) => Promise<Response>>();
  const hubNamed = (name: string) => {
    const known = hubs.get(name);
    if (known !== undefined) return known;
    const socket = fakeSocket();
    sockets.set(name, socket);
    const state = fakeHubState([socket]);
    const core = createHubCore(state, { setTimeout }, () => wakeInstant);
    const served = (request: Request) => hubFetch(core, state, request);
    hubs.set(name, served);
    return served;
  };
  return {
    namespace: {
      idFromName: (name) => name,
      get: (id) => ({
        fetch: (input, init) => hubNamed(String(id))(new Request(input, init)),
      }),
    },
    sent: () => [...sockets.values()].flatMap((socket) => socket.sent),
  };
}
