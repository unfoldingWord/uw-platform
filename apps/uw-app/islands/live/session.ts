import ReconnectingWebSocket from 'partysocket/ws';
import { hubWakeSchema, type EventPageReply, type HarnessEvent } from '@uw/contracts';
import { EventReadRefused } from './read-events.ts';

export type LiveSocket = {
  addEventListener(
    type: 'open' | 'close' | 'message',
    listener: (event: { readonly data?: unknown }) => void,
  ): void;
  close(): void;
};

export type LiveTimers = {
  setInterval(run: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
};

export type LiveSessionOptions = {
  readonly harnessId: string;
  readonly cursor: number;
  readonly read: (after: number) => Promise<EventPageReply>;
  readonly connect: () => LiveSocket;
  readonly onEvents: (events: readonly HarnessEvent[]) => void;
  readonly timers: LiveTimers;
};

export type LiveSession = { cursor(): number; close(): void };

export const POLL_MS = 15_000;

export const BACKOFF = {
  minReconnectionDelay: 1_000,
  maxReconnectionDelay: 30_000,
  reconnectionDelayGrowFactor: 2,
} as const;

const CONNECTION_TIMEOUT_MS = 10_000;
const accessGone = new Set(['harness_not_found', 'item_not_found']);

type State = {
  readonly options: LiveSessionOptions;
  cursor: number;
  reading: boolean;
  again: boolean;
  poll: unknown;
  closed: boolean;
  socket: LiveSocket | null;
};

function freshEvents(events: readonly HarnessEvent[], cursor: number): HarnessEvent[] {
  const fresh: HarnessEvent[] = [];
  let last = cursor;
  for (const event of [...events].sort((a, b) => a.position - b.position)) {
    if (event.position <= last) continue;
    fresh.push(event);
    last = event.position;
  }
  return fresh;
}

async function drain(state: State): Promise<void> {
  for (;;) {
    const page = await state.options.read(state.cursor);
    if (state.closed) return;
    const fresh = freshEvents(page.events, state.cursor);
    const last = fresh.at(-1);
    if (last === undefined) return;
    state.options.onEvents(fresh);
    state.cursor = Math.max(state.cursor, last.position);
    if (page.next === null) return;
  }
}

function stopPolling(state: State): void {
  if (state.poll === null) return;
  state.options.timers.clearInterval(state.poll);
  state.poll = null;
}

function startPolling(state: State): void {
  if (state.closed || state.poll !== null) return;
  state.poll = state.options.timers.setInterval(() => void pull(state), POLL_MS);
}

function stop(state: State): void {
  state.closed = true;
  stopPolling(state);
  state.socket?.close();
}

function revoked(error: unknown): boolean {
  return error instanceof EventReadRefused && error.reason !== null && accessGone.has(error.reason);
}

async function pull(state: State): Promise<void> {
  if (state.closed) return;
  if (state.reading) {
    state.again = true;
    return;
  }
  state.reading = true;
  try {
    do {
      state.again = false;
      await drain(state);
    } while (state.again && !state.closed);
  } catch (error) {
    if (revoked(error)) stop(state);
  } finally {
    state.reading = false;
  }
}

function isWake(data: unknown, harnessId: string): boolean {
  if (typeof data !== 'string') return false;
  try {
    const wake = hubWakeSchema.safeParse(JSON.parse(data));
    return wake.success && wake.data.harnessId === harnessId;
  } catch {
    return false;
  }
}

function listen(state: State, socket: LiveSocket): void {
  socket.addEventListener('open', () => {
    if (state.closed) return;
    stopPolling(state);
    void pull(state);
  });
  socket.addEventListener('close', () => startPolling(state));
  socket.addEventListener('message', (event) => {
    if (isWake(event.data, state.options.harnessId)) void pull(state);
  });
}

export function startLiveSession(options: LiveSessionOptions): LiveSession {
  const state: State = {
    options,
    cursor: options.cursor,
    reading: false,
    again: false,
    poll: null,
    closed: false,
    socket: null,
  };
  startPolling(state);
  state.socket = options.connect();
  listen(state, state.socket);
  return { cursor: () => state.cursor, close: () => stop(state) };
}

export function reconnectingSocket(url: string): LiveSocket {
  return new ReconnectingWebSocket(url, [], {
    ...BACKOFF,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
  });
}
