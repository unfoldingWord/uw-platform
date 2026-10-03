import { describe, expect, it } from 'vitest';
import { hubWakeSchema } from '@uw/contracts';
import * as entry from '../index.ts';
import { closeNormally, HarnessHub, openHub } from './harness-hub.ts';
import { createHubCore, hubFetch } from './hub-core.ts';
import { fakeHubState, fakeSocket, manualTimers, wakeInstant } from './testing.ts';

const first = 'b3000000-0000-4000-8000-000000000001';
const second = 'b3000000-0000-4000-8000-000000000002';

function hubWith(sockets: ReturnType<typeof fakeSocket>[]) {
  const state = fakeHubState([...sockets]);
  const timers = manualTimers();
  const core = createHubCore(state, timers, () => wakeInstant);
  return { state, timers, core };
}

function wakeOf(harnessId: string): string {
  return JSON.stringify({ type: 'wake', harnessId });
}

function hubRequest(path: string, init?: RequestInit): Request {
  return new Request(`https://hub.internal${path}`, init);
}

describe('WB-3 the live hub wakes its sessions with nothing but the harness id', () => {
  it('WB-3 a wake sends every session one message carrying only the harness id', async () => {
    const sockets = [fakeSocket(), fakeSocket()];
    const { core, timers } = hubWith(sockets);
    core.wake(first);
    await timers.runAll();
    for (const socket of sockets) {
      expect(socket.sent).toEqual([wakeOf(first)]);
      expect(hubWakeSchema.parse(JSON.parse(socket.sent[0] ?? ''))).toEqual({
        type: 'wake',
        harnessId: first,
      });
    }
  });

  it('WB-3 wakes in one tick coalesce to one message', async () => {
    const socket = fakeSocket();
    const { core, timers } = hubWith([socket]);
    core.wake(first);
    core.wake(first);
    core.wake(first);
    await timers.runAll();
    expect(socket.sent).toEqual([wakeOf(first)]);
  });

  it('WB-3 a socket that throws on send does not stop the others', async () => {
    const healthy = fakeSocket();
    const { core, timers } = hubWith([fakeSocket(true), healthy]);
    core.wake(first);
    await timers.runAll();
    expect(healthy.sent).toEqual([wakeOf(first)]);
  });

  it('WB-3 stats count the connections and the last wake time', async () => {
    const { core, timers } = hubWith([fakeSocket(), fakeSocket()]);
    expect(await core.stats()).toEqual({ connections: 2, lastWakeAt: null });
    core.wake(first);
    await timers.runAll();
    expect(await core.stats()).toEqual({
      connections: 2,
      lastWakeAt: wakeInstant.toISOString(),
    });
  });
});

describe('the live hub between ticks', () => {
  it('wakes again in a later tick, and stores nothing but the last wake time', async () => {
    const socket = fakeSocket();
    const { core, timers, state } = hubWith([socket]);
    core.wake(first);
    await timers.runAll();
    core.wake(second);
    await timers.runAll();
    expect(socket.sent).toEqual([wakeOf(first), wakeOf(second)]);
    expect([...state.stored.keys()]).toEqual(['lastWakeAt']);
  });
});

describe('the live hub when its storage fails', () => {
  it('still wakes its sessions and leaves no rejection unhandled when the last wake time cannot be stored', async () => {
    const socket = fakeSocket();
    const state = fakeHubState([socket]);
    const failing = {
      ...state,
      storage: { ...state.storage, put: () => Promise.reject(new Error('storage down')) },
    };
    const timers = manualTimers();
    createHubCore(failing, timers, () => wakeInstant).wake(first);
    await timers.runAll();
    expect(socket.sent).toEqual([wakeOf(first)]);
  });
});

describe('WB-3 the hub answers only its three internal paths', () => {
  it('WB-3 /connect without an Upgrade header is 426; /wake with a malformed body is 400; an unknown path is 404', async () => {
    const { core, state } = hubWith([]);
    const connect = await hubFetch(core, state, hubRequest('/connect'));
    const malformed = await hubFetch(
      core,
      state,
      hubRequest('/wake', { method: 'POST', body: JSON.stringify({ harnessId: 'nope' }) }),
    );
    const unknown = await hubFetch(core, state, hubRequest('/elsewhere'));
    expect([connect.status, malformed.status, unknown.status]).toEqual([426, 400, 404]);
  });

  it('accepts a socket on /connect with an Upgrade header', async () => {
    const { core, state } = hubWith([]);
    const answer = await hubFetch(
      core,
      state,
      hubRequest('/connect', { headers: { Upgrade: 'websocket' } }),
    );
    expect(answer.status).toBe(101);
    expect(answer.webSocket).not.toBeNull();
    expect(state.getWebSockets()).toHaveLength(1);
  });

  it('wakes on a well-formed POST /wake and reports its stats on GET /stats', async () => {
    const socket = fakeSocket();
    const { core, state, timers } = hubWith([socket]);
    const woken = await hubFetch(
      core,
      state,
      hubRequest('/wake', { method: 'POST', body: JSON.stringify({ harnessId: first }) }),
    );
    await timers.runAll();
    const stats = await hubFetch(core, state, hubRequest('/stats'));
    expect(woken.status).toBe(202);
    expect(socket.sent).toEqual([wakeOf(first)]);
    expect(await stats.json()).toEqual({ connections: 1, lastWakeAt: wakeInstant.toISOString() });
  });
});

describe('the hub refuses what is not a bare wake', () => {
  it('refuses a wake that carries anything beside the harness id, and a GET on /wake', async () => {
    const { core, state } = hubWith([]);
    const extra = await hubFetch(
      core,
      state,
      hubRequest('/wake', {
        method: 'POST',
        body: JSON.stringify({ harnessId: first, body: 'event' }),
      }),
    );
    const read = await hubFetch(core, state, hubRequest('/wake'));
    expect([extra.status, read.status]).toEqual([400, 404]);
  });
});

function hubContext(recorded: WebSocketRequestResponsePair[]) {
  const state = fakeHubState();
  return {
    acceptWebSocket: state.acceptWebSocket,
    getWebSockets: () => [],
    storage: { get: async () => undefined, put: async () => undefined },
    setWebSocketAutoResponse: (pair?: WebSocketRequestResponsePair) => {
      if (pair) recorded.push(pair);
    },
  };
}

describe('the HarnessHub Durable Object', () => {
  it('exports the HarnessHub class from the Worker entry', () => {
    expect(entry.HarnessHub).toBe(HarnessHub);
  });

  it('registers ping as a request the runtime answers with pong when the object opens', () => {
    const recorded: WebSocketRequestResponsePair[] = [];
    openHub(hubContext(recorded));
    expect(recorded.map((pair) => [pair.request, pair.response])).toEqual([['ping', 'pong']]);
  });

  it('closes a socket with 1000, never echoing the code the client closed with', () => {
    const closed: [number | undefined, string | undefined][] = [];
    closeNormally({ close: (code, reason) => void closed.push([code, reason]) });
    expect(closed).toEqual([[1000, 'closed']]);
  });
});
