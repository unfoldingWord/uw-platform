import { readEvents } from '../live/read-events.ts';
import { startLiveSession, type LiveSocket, type LiveTimers } from '../live/session.ts';
import type { Refresher } from './refresh.ts';

type LiveDeps = {
  readonly fetch: typeof fetch;
  readonly connect: (url: string) => LiveSocket;
  readonly timers: LiveTimers;
  readonly refresher: Refresher;
};

type Watched = {
  readonly harnessId: string;
  readonly itemId: string | null;
  readonly screen: string | null;
  readonly cursor: number;
};

const wholeNumber = /^\d{1,15}$/;

function watchedOf(markers: readonly Element[]): readonly Watched[] {
  const seen = new Map<string, Watched>();
  for (const marker of markers) {
    const harnessId = marker.getAttribute('data-live-harness');
    if (harnessId === null || seen.has(harnessId)) continue;
    const cursor = marker.getAttribute('data-cursor') ?? '';
    seen.set(harnessId, {
      harnessId,
      itemId: marker.getAttribute('data-live-item'),
      screen: marker.getAttribute('data-live-screen'),
      cursor: wholeNumber.test(cursor) ? Number(cursor) : 0,
    });
  }
  return [...seen.values()];
}

function watchQuery(watched: Watched): string {
  if (watched.screen === null) return '';
  const params = new URLSearchParams({ screen: watched.screen });
  if (watched.screen === 'item' && watched.itemId !== null) params.set('item', watched.itemId);
  return `?${params.toString()}`;
}

function liveUrl(location: Location, watched: Watched): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = `/api/harness/${encodeURIComponent(watched.harnessId)}/live`;
  return `${scheme}//${location.host}${path}${watchQuery(watched)}`;
}

function refreshEvery(root: Document, markers: readonly Element[], deps: LiveDeps): void {
  const every = markers.map((marker) => marker.getAttribute('data-refresh-every') ?? '');
  const ms = every.filter((value) => wholeNumber.test(value)).map(Number);
  const shortest = ms.length === 0 ? null : Math.min(...ms);
  if (shortest === null || shortest < 1) return;
  deps.timers.setInterval(() => {
    if (root.visibilityState === 'visible') void deps.refresher.refresh();
  }, shortest);
}

export function startLive(root: Document, deps: LiveDeps): void {
  const markers = [...root.querySelectorAll('[data-live]')];
  for (const watched of watchedOf(markers)) {
    startLiveSession({
      harnessId: watched.harnessId,
      cursor: watched.cursor,
      read: readEvents(deps.fetch, watched.harnessId, watched.itemId),
      connect: () => deps.connect(liveUrl(root.location, watched)),
      onEvents: () => void deps.refresher.refresh(),
      timers: deps.timers,
    });
  }
  refreshEvery(root, markers, deps);
}
