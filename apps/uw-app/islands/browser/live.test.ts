import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { LiveSocket, LiveTimers } from '../live/session.ts';
import { startLive } from './live.ts';

const harnessA = 'd7000000-0000-4000-8000-00000000000a';
const harnessB = 'd7000000-0000-4000-8000-00000000000b';
const itemId = 'd7000000-0000-4000-8000-0000000000c1';

type Listener = (event: { readonly data?: unknown }) => void;

function fakeSocket(sockets: Map<string, Map<string, Listener>>, url: string): LiveSocket {
  const listeners = new Map<string, Listener>();
  sockets.set(url, listeners);
  return {
    addEventListener: (type, listener) => {
      listeners.set(type, listener);
    },
    close: () => undefined,
  };
}

function event(harnessId: string, position: number) {
  return {
    eventId: `d7000000-0000-4000-8000-${position.toString().padStart(12, '0')}`,
    harnessId,
    itemId,
    name: 'gate_approved',
    position,
    at: '2026-10-01T09:00:00.000Z',
    actor: 'human:d7000000-0000-4000-8000-000000000002',
    evidence: { decisionId: 'd7000000-0000-4000-8000-0000000000d1', stage: 'ship' },
    traceId: 'd7000000-0000-4000-8000-0000000000f1',
    requestId: null,
  };
}

type Interval = { readonly run: () => void; readonly ms: number };

function timers(intervals: Interval[]): LiveTimers {
  return {
    setInterval: (run, ms) => intervals.push({ run, ms }),
    clearInterval: () => undefined,
  };
}

async function settled(): Promise<void> {
  for (let n = 0; n < 5; n += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function oneSessionPerHarness(): Promise<void> {
  const dom = new JSDOM(
    `<!DOCTYPE html><body><main id="main"><div data-live data-live-harness="${harnessA}" data-cursor="4"></div><div data-live data-live-harness="${harnessA}" data-cursor="4"></div><div data-live data-live-harness="${harnessB}" data-live-item="${itemId}" data-cursor="9"></div></main></body>`,
    { url: 'https://uw.example/' },
  );
  const asked: string[] = [];
  const sockets = new Map<string, Map<string, Listener>>();
  let refreshed = 0;
  startLive(dom.window.document, {
    fetch: (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      const harnessId = String(input).includes(harnessA) ? harnessA : harnessB;
      return Response.json({ events: [event(harnessId, 12)], next: null });
    }) as typeof fetch,
    connect: (url) => fakeSocket(sockets, url),
    timers: timers([]),
    refresher: {
      refresh: async () => {
        refreshed += 1;
      },
    },
  });
  expect([...sockets.keys()]).toEqual([
    `wss://uw.example/api/harness/${harnessA}/live`,
    `wss://uw.example/api/harness/${harnessB}/live`,
  ]);
  for (const listeners of sockets.values()) listeners.get('open')?.({});
  await settled();
  expect(asked).toEqual([
    `/api/harness/${harnessA}/events?after=4`,
    `/api/harness/${harnessB}/events?after=9&item=${itemId}`,
  ]);
  expect(refreshed).toBe(2);
}

async function refreshWhileVisible(): Promise<void> {
  const dom = new JSDOM(
    `<!DOCTYPE html><body><main id="main"><div data-live data-refresh-every="60000" data-cursor="0"></div></main></body>`,
    { url: 'https://uw.example/' },
  );
  const intervals: Interval[] = [];
  let refreshed = 0;
  let visibility = 'visible';
  Object.defineProperty(dom.window.document, 'visibilityState', { get: () => visibility });
  startLive(dom.window.document, {
    fetch: (async () => Response.json({ events: [], next: null })) as typeof fetch,
    connect: () => ({ addEventListener: () => undefined, close: () => undefined }),
    timers: timers(intervals),
    refresher: {
      refresh: async () => {
        refreshed += 1;
      },
    },
  });
  const every = intervals.filter((interval) => interval.ms === 60_000);
  expect(every).toHaveLength(1);
  every[0]?.run();
  expect(refreshed).toBe(1);
  visibility = 'hidden';
  every[0]?.run();
  expect(refreshed).toBe(1);
}

describe('the live islands', () => {
  it(
    'one session per harness on the page reads from its cursor and refreshes on new events',
    oneSessionPerHarness,
  );
  it(
    'a page that asks for it refreshes every interval while visible and not while hidden',
    refreshWhileVisible,
  );
});
