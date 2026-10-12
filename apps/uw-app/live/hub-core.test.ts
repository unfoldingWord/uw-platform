import { describe, expect, it } from 'vitest';
import { hubWakeSchema } from '@uw/contracts';
import * as entry from '../index.ts';
import { closeNormally, HarnessHub, openHub } from './harness-hub.ts';
import { createHubCore, hubFetch, SOCKET_MAX_AGE_MS, SOCKETS_PER_PERSON } from './hub-core.ts';
import {
  fakeHubState,
  fakeSocket,
  manualTimers,
  socketOwner,
  wakeInstant,
  type FakeSocket,
} from './testing.ts';

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

describe('WB-3 the hub answers only its internal paths', () => {
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
      hubRequest('/connect', { headers: { Upgrade: 'websocket', 'x-hub-person': socketOwner } }),
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
    storage: {
      get: async () => undefined,
      put: async () => undefined,
      getAlarm: async () => null,
      setAlarm: async () => undefined,
    },
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

const start = wakeInstant.getTime();
const stranger = 'b3000000-0000-4000-8000-0000000000bb';
const unwatched = { person: socketOwner, screen: null, itemId: null };

function openedAt(minutes: number, person = socketOwner): FakeSocket {
  return fakeSocket(false, { openedAt: start + minutes * 60_000, person });
}

function clockAt(minutes: number): () => Date {
  return () => new Date(start + minutes * 60_000);
}

describe('the hub closes sockets older than an hour so every session re-checks access', () => {
  it('closes an hour-old socket with 1000 on the alarm, counting from its accept even after hibernation', async () => {
    const socket = fakeSocket(false, null);
    const state = fakeHubState([socket]);
    await createHubCore(state, manualTimers(), clockAt(0)).admit(socket, unwatched);
    expect(state.alarm()).toBe(start + SOCKET_MAX_AGE_MS);
    const young = openedAt(30);
    const woken = fakeHubState([socket, young]);
    await createHubCore(woken, manualTimers(), clockAt(59)).shed();
    expect(socket.closed).toEqual([]);
    await createHubCore(woken, manualTimers(), clockAt(60)).shed();
    expect(socket.closed).toEqual([[1000, 'closed']]);
    expect(young.closed).toEqual([]);
    expect(woken.alarm()).toBe(start + 30 * 60_000 + SOCKET_MAX_AGE_MS);
  });

  it('closes old and untagged sockets before a wake, so they get no message', async () => {
    const old = openedAt(0);
    const untagged = fakeSocket(false, null);
    const fresh = openedAt(45);
    const timers = manualTimers();
    const core = createHubCore(fakeHubState([old, untagged, fresh]), timers, clockAt(61));
    core.wake(first);
    await timers.runAll();
    expect(old.closed).toEqual([[1000, 'closed']]);
    expect(untagged.closed).toEqual([[1000, 'closed']]);
    expect([old.sent, untagged.sent, fresh.sent]).toEqual([[], [], [wakeOf(first)]]);
    expect(await core.stats()).toMatchObject({ connections: 1 });
  });
});

describe('the hub holds at most 100 sockets from one person', () => {
  it('closes the oldest socket of that person when a new one would pass the cap', async () => {
    const own = Array.from({ length: SOCKETS_PER_PERSON }, (_, index) => openedAt(index / 10));
    const other = openedAt(0, stranger);
    const newest = fakeSocket(false, null);
    const state = fakeHubState([...own, other, newest]);
    await createHubCore(state, manualTimers(), clockAt(20)).admit(newest, unwatched);
    expect(own[0]?.closed).toEqual([[1000, 'closed']]);
    expect(own.slice(1).every((socket) => socket.closed.length === 0)).toBe(true);
    expect(other.closed).toEqual([]);
    expect(newest.closed).toEqual([]);
  });

  it('refuses a connect that names no person', async () => {
    const { core, state } = hubWith([]);
    const answer = await hubFetch(
      core,
      state,
      hubRequest('/connect', { headers: { Upgrade: 'websocket' } }),
    );
    expect(answer.status).toBe(400);
    expect(state.getWebSockets()).toHaveLength(0);
  });
});

const item = 'b3000000-0000-4000-8000-0000000000c1';
const otherItem = 'b3000000-0000-4000-8000-0000000000c2';

function watching(screen: string | null, itemId: string | null = null, person = socketOwner) {
  return fakeSocket(false, { openedAt: start, person, screen, itemId });
}

async function presence(sockets: FakeSocket[], query: string) {
  const { core, state } = hubWith(sockets);
  const answer = await hubFetch(core, state, hubRequest(`/presence?${query}`));
  return { status: answer.status, body: answer.status === 200 ? await answer.json() : null };
}

describe('the hub knows which screen and item each session watches', () => {
  it('a person is present on the screen and item their session connected for', async () => {
    const sockets = [watching('gates'), watching('item', item)];
    const ask = (query: string) => presence(sockets, query);
    expect(await ask(`person=${socketOwner}&screen=gates`)).toEqual({
      status: 200,
      body: { present: true },
    });
    expect((await ask(`person=${socketOwner}&screen=item&item=${item}`)).body).toEqual({
      present: true,
    });
    expect((await ask(`person=${socketOwner}&screen=item&item=${otherItem}`)).body).toEqual({
      present: false,
    });
    expect((await ask(`person=${socketOwner}&screen=home`)).body).toEqual({ present: false });
    expect((await ask(`person=${stranger}&screen=gates`)).body).toEqual({ present: false });
  });

  it('a socket accepted before this change, with no screen in its attachment, stays open and is never presence', async () => {
    const before = fakeSocket(false, { openedAt: start, person: socketOwner });
    const state = fakeHubState([before]);
    const core = createHubCore(state, manualTimers(), clockAt(1));
    await core.shed();
    expect(before.closed).toEqual([]);
    expect(core.present({ person: socketOwner, screen: 'home', itemId: null })).toBe(false);
  });

  it('presence ignores closed sockets', async () => {
    const closed = watching('gates');
    closed.close(1000, 'closed');
    expect((await presence([closed], `person=${socketOwner}&screen=gates`)).body).toEqual({
      present: false,
    });
  });

  it('GET /presence with a malformed person or screen answers 400', async () => {
    const asked = await Promise.all(
      [
        'person=nobody&screen=gates',
        `person=${socketOwner}&screen=nowhere`,
        `person=${socketOwner}`,
        `person=${socketOwner}&screen=item`,
        `person=${socketOwner}&screen=gates&item=${item}`,
        `person=${socketOwner}&screen=item&item=not-an-item`,
      ].map((query) => presence([], query)),
    );
    expect(asked.map((answer) => answer.status)).toEqual([400, 400, 400, 400, 400, 400]);
  });
});

describe('the hub tags each socket with what its connect named', () => {
  it('tags a socket with the screen and item its connect named', async () => {
    const { core, state } = hubWith([]);
    const headers = {
      Upgrade: 'websocket',
      'x-hub-person': socketOwner,
      'x-hub-screen': 'item',
      'x-hub-item': item,
    };
    expect((await hubFetch(core, state, hubRequest('/connect', { headers }))).status).toBe(101);
    const [socket] = state.getWebSockets();
    expect(socket?.deserializeAttachment()).toEqual({
      openedAt: wakeInstant.getTime(),
      person: socketOwner,
      screen: 'item',
      itemId: item,
    });
  });

  it('refuses a connect that names an unknown screen, or an item without the item screen', async () => {
    const { core, state } = hubWith([]);
    const base = { Upgrade: 'websocket', 'x-hub-person': socketOwner };
    const asks = [
      { ...base, 'x-hub-screen': 'nowhere' },
      { ...base, 'x-hub-screen': 'gates', 'x-hub-item': item },
      { ...base, 'x-hub-screen': 'item' },
    ];
    const statuses = await Promise.all(
      asks.map(
        async (headers) =>
          (await hubFetch(core, state, hubRequest('/connect', { headers }))).status,
      ),
    );
    expect(statuses).toEqual([400, 400, 400]);
    expect(state.getWebSockets()).toHaveLength(0);
  });
});
