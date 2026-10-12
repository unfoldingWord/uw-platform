import type { AppDeps } from '../deps.ts';
import { systemClock } from '../ports/clock.ts';
import { systemTimers } from '../timers.ts';

export function recordingDeps() {
  const lines: Record<string, unknown>[] = [];
  const deps: AppDeps = {
    openDatabase: () => null,
    accessKeys: () => async () => {
      throw new Error('no Access keys in this test');
    },
    newId: () => crypto.randomUUID(),
    sink: (line) => lines.push(JSON.parse(line)),
    clock: systemClock,
    timers: systemTimers,
    fetch: () => Promise.reject(new Error('no network in this test')),
  };
  return { deps, lines };
}
