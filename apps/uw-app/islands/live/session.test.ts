import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { identitySchema, type EventPageReply, type HarnessEvent } from '@uw/contracts';
import { EventReadRefused } from './read-events.ts';
import {
  BACKOFF,
  POLL_MS,
  reconnectingSocket,
  startLiveSession,
  type LiveSession,
  type LiveSocket,
  type LiveTimers,
} from './session.ts';

const harnessId = 'b5000000-0000-4000-8000-000000000001';
const otherHarness = 'b5000000-0000-4000-8000-000000000002';

const actor = identitySchema.parse('human:b5000000-0000-4000-8000-0000000000aa');

type Listener = (event: { readonly data?: unknown }) => void;

function fakeSocket() {
  const listeners = new Map<string, Listener[]>();
  let closed = false;
  const socket: LiveSocket = {
    addEventListener: (type, listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    close: () => {
      closed = true;
    },
  };
  const emit = (type: 'open' | 'close' | 'message', data?: unknown) => {
    for (const listener of listeners.get(type) ?? []) listener({ data });
  };
  return { socket, emit, closed: () => closed };
}

function eventAt(position: number): HarnessEvent {
  return {
    eventId: `b5000000-0000-4000-8000-${String(position).padStart(12, '0')}`,
    harnessId,
    itemId: null,
    name: 'item_created',
    position,
    at: '2026-10-03T09:00:00.000Z',
    actor,
    evidence: {},
    traceId: 'b5000000-0000-4000-8000-0000000000cc',
    requestId: null,
  };
}

function eventLog(pageSize: number) {
  const events: HarnessEvent[] = [];
  const asked: number[] = [];
  const append = (count: number) => {
    for (let index = 0; index < count; index += 1) events.push(eventAt(events.length + 1));
  };
  const read = async (after: number): Promise<EventPageReply> => {
    asked.push(after);
    const page = events.filter((event) => event.position > after).slice(0, pageSize);
    const more = events.some((event) => event.position > (page.at(-1)?.position ?? after));
    return { events: page, next: more ? (page.at(-1)?.position ?? null) : null };
  };
  return { append, read, asked };
}

const timers: LiveTimers = {
  setInterval: (run, ms) => setInterval(run, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

function wake(id = harnessId): string {
  return JSON.stringify({ type: 'wake', harnessId: id });
}

const settle = () => vi.advanceTimersByTimeAsync(0);

type Harness = {
  socket: ReturnType<typeof fakeSocket>;
  delivered: number[];
  session: LiveSession;
};

function start(cursor: number, read: (after: number) => Promise<EventPageReply>): Harness {
  const socket = fakeSocket();
  const delivered: number[] = [];
  const session = startLiveSession({
    harnessId,
    cursor,
    read,
    connect: () => socket.socket,
    onEvents: (events) => delivered.push(...events.map((event) => event.position)),
    timers,
  });
  return { socket, delivered, session };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WB-3 the session reads from its own cursor', () => {
  it('WB-3 on open the session reads from its cursor and delivers each event once, in order', async () => {
    const log = eventLog(2);
    log.append(5);
    const { socket, delivered, session } = start(2, log.read);
    socket.emit('open');
    await settle();
    expect(log.asked).toEqual([2, 4]);
    expect(delivered).toEqual([3, 4, 5]);
    expect(session.cursor()).toBe(5);
    session.close();
  });

  it('WB-3 a wake makes the session read after its cursor; a wake during a read causes exactly one more read', async () => {
    const log = eventLog(100);
    let release = () => {};
    const gated = async (after: number) => {
      const page = await log.read(after);
      await new Promise<void>((resolve) => (release = resolve));
      return page;
    };
    const { socket, delivered, session } = start(0, gated);
    log.append(1);
    socket.emit('open');
    log.append(2);
    socket.emit('message', wake());
    socket.emit('message', wake());
    socket.emit('message', wake());
    await settle();
    release();
    await settle();
    expect(log.asked).toEqual([0, 1]);
    release();
    await settle();
    expect(log.asked).toEqual([0, 1]);
    expect(delivered).toEqual([1, 2, 3]);
    expect(session.cursor()).toBe(3);
    session.close();
  });
});

describe('WB-3 the cursor only moves forward', () => {
  it('WB-3 the cursor never moves backwards, even when a read answers a stale or unordered page', async () => {
    const pages: EventPageReply[] = [
      { events: [eventAt(1), eventAt(2), eventAt(3)], next: null },
      { events: [eventAt(1), eventAt(2)], next: null },
      { events: [eventAt(5), eventAt(3), eventAt(4), eventAt(5)], next: null },
    ];
    const read = async () => pages.shift() ?? { events: [], next: null };
    const { socket, delivered, session } = start(0, read);
    socket.emit('open');
    await settle();
    socket.emit('message', wake());
    await settle();
    expect(session.cursor()).toBe(3);
    socket.emit('message', wake());
    await settle();
    expect(delivered).toEqual([1, 2, 3, 4, 5]);
    expect(session.cursor()).toBe(5);
    session.close();
  });
});

describe('WB-3 polling is the fallback', () => {
  it('WB-3 while the socket is closed the session polls every 15 seconds, and stops polling once it opens', async () => {
    const log = eventLog(100);
    const { socket, session } = start(0, log.read);
    await vi.advanceTimersByTimeAsync(POLL_MS - 1);
    expect(log.asked).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(log.asked).toHaveLength(2);
    socket.emit('open');
    await settle();
    await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    expect(log.asked).toHaveLength(3);
    socket.emit('close');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(log.asked).toHaveLength(4);
    session.close();
    await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    expect(log.asked).toHaveLength(4);
    expect(socket.closed()).toBe(true);
  });

  it('WB-3 killing the hub mid-session loses nothing', async () => {
    const log = eventLog(100);
    const { socket, delivered, session } = start(0, log.read);
    log.append(2);
    socket.emit('open');
    await settle();
    expect(delivered).toEqual([1, 2]);
    socket.emit('close');
    log.append(3);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    socket.emit('open');
    await settle();
    expect(delivered).toEqual([1, 2, 3, 4, 5]);
    expect(session.cursor()).toBe(5);
    session.close();
  });
});

describe('WB-3 the session trusts no socket message', () => {
  it('WB-3 a message that is not a wake is ignored, and a failed read keeps the cursor', async () => {
    const log = eventLog(100);
    let failing = false;
    const read = async (after: number) => {
      if (failing) throw new Error('network down');
      return log.read(after);
    };
    const { socket, delivered, session } = start(0, read);
    log.append(2);
    socket.emit('open');
    await settle();
    const ignored = ['pong', '{not json', wake(otherHarness), 7, '{"type":"wake"}'];
    for (const data of ignored) socket.emit('message', data);
    socket.emit('message', JSON.stringify({ type: 'wake', harnessId, events: [eventAt(9)] }));
    await settle();
    expect(log.asked).toEqual([0]);
    failing = true;
    log.append(1);
    socket.emit('message', wake());
    await settle();
    expect(session.cursor()).toBe(2);
    failing = false;
    socket.emit('message', wake());
    await settle();
    expect(delivered).toEqual([1, 2, 3]);
    session.close();
  });
});

describe('a session whose access is gone', () => {
  it.each(['harness_not_found', 'item_not_found'])(
    'stops when a read is refused %s: the socket closes and nothing reads again',
    async (reason) => {
      let reads = 0;
      const read = async () => {
        reads += 1;
        throw new EventReadRefused(reason);
      };
      const { socket, session } = start(4, read);
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(socket.closed()).toBe(true);
      expect(session.status()).toBe('access_lost');
      socket.emit('open');
      socket.emit('message', wake());
      await vi.advanceTimersByTimeAsync(POLL_MS * 4);
      expect(reads).toBe(1);
    },
  );

  it('keeps polling after a refusal that is not about access', async () => {
    let reads = 0;
    const read = async () => {
      reads += 1;
      throw new EventReadRefused('database_not_configured');
    };
    const { socket, session } = start(0, read);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(reads).toBe(3);
    expect(socket.closed()).toBe(false);
    expect(session.status()).toBe('live');
    session.close();
  });

  it('stops with a closed error state after 20 failed reads in a row, counting again after a success', async () => {
    let reads = 0;
    const read = async (): Promise<EventPageReply> => {
      reads += 1;
      if (reads === 19) return { events: [], next: null };
      throw new EventReadRefused('unauthenticated');
    };
    const { socket, session } = start(0, read);
    await vi.advanceTimersByTimeAsync(POLL_MS * 38);
    expect(session.status()).toBe('live');
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(reads).toBe(39);
    expect(session.status()).toBe('read_failed');
    expect(socket.closed()).toBe(true);
    await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    expect(reads).toBe(39);
  });
});

describe('a failed read while the socket is open', () => {
  it('polls again until a read succeeds, then stops polling', async () => {
    const log = eventLog(100);
    let failing = true;
    const read = async (after: number) => {
      if (failing) {
        failing = false;
        throw new Error('network down');
      }
      return log.read(after);
    };
    const { socket, delivered, session } = start(0, read);
    log.append(2);
    socket.emit('open');
    await settle();
    expect(delivered).toEqual([]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(delivered).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    expect(log.asked).toEqual([0]);
    session.close();
  });
});

class FakeWebSocket extends EventTarget {
  static made: FakeWebSocket[] = [];
  readyState = 0;
  binaryType = 'blob';
  readonly url: string;

  constructor(url: string) {
    super();
    this.url = url;
    FakeWebSocket.made.push(this);
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }

  drop(code: number): void {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event('close'), { code, reason: '' }));
  }
}

const liveUrl = `wss://app.example/api/harness/${harnessId}/live`;

async function expectReconnectAfter(delay: number): Promise<void> {
  const before = FakeWebSocket.made.length;
  await vi.advanceTimersByTimeAsync(delay - 1);
  expect(FakeWebSocket.made).toHaveLength(before);
  await vi.advanceTimersByTimeAsync(1);
  expect(FakeWebSocket.made).toHaveLength(before + 1);
}

function latest(): FakeWebSocket {
  const socket = FakeWebSocket.made.at(-1);
  if (socket === undefined) throw new Error('no socket was made');
  return socket;
}

function useFakeWebSocket(): void {
  beforeEach(() => {
    FakeWebSocket.made = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
}

describe('the reconnecting socket', () => {
  useFakeWebSocket();

  it('retries a failing connection after 1 second, doubling each time, and never waits past 30 seconds', async () => {
    const socket = reconnectingSocket(liveUrl);
    await settle();
    expect(latest().url).toBe(liveUrl);
    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
      latest().drop(1006);
      await expectReconnectAfter(delay);
    }
    socket.close();
    expect(BACKOFF).toEqual({
      minReconnectionDelay: 1_000,
      maxReconnectionDelay: 30_000,
      reconnectionDelayGrowFactor: 2,
    });
  });
});

describe('the reconnecting socket under a live session', () => {
  useFakeWebSocket();

  it('reconnects 1 second after the hub closes a long-lived socket normally, even after failed connects, and the session catches up', async () => {
    const log = eventLog(100);
    const delivered: number[] = [];
    const session = startLiveSession({
      harnessId,
      cursor: 0,
      read: log.read,
      connect: () => reconnectingSocket(liveUrl),
      onEvents: (events) => delivered.push(...events.map((event) => event.position)),
      timers,
    });
    await settle();
    for (const delay of [1_000, 2_000, 4_000]) {
      latest().drop(1006);
      await expectReconnectAfter(delay);
    }
    log.append(1);
    latest().open();
    await vi.advanceTimersByTimeAsync(5_001);
    latest().drop(1000);
    log.append(2);
    await expectReconnectAfter(1_000);
    latest().open();
    await settle();
    expect(delivered).toEqual([1, 2, 3]);
    session.close();
  });
});
