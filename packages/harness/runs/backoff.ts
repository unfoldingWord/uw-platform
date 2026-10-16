import type { HarnessEvent, Identity } from '@uw/contracts';

const FIRST_BACKOFF_MS = 15 * 60 * 1000;
const BACKOFF_CAP_MS = 24 * 60 * 60 * 1000;
const fruitless: ReadonlySet<unknown> = new Set(['premise_held', 'review_refused']);

type Streak = {
  readonly count: number;
  readonly last: string | null;
  readonly runs: ReadonlySet<unknown>;
};

const none: Streak = { count: 0, last: null, runs: new Set() };

export function setsHead(event: HarnessEvent): boolean {
  if (event.name === 'branch_adopted') return true;
  return event.name === 'submitted_to_gate' && event.evidence['expectedHead'] != null;
}

function counted(streak: Streak, event: HarnessEvent): Streak {
  return { ...streak, count: streak.count + 1, last: event.at };
}

function leaseLost(streak: Streak, event: HarnessEvent): boolean {
  return (
    event.name === 'run_stopped' &&
    event.evidence['why'] === 'lease_expired' &&
    streak.runs.has(event.evidence['runId'])
  );
}

function started(streak: Streak, event: HarnessEvent, persona: Identity): Streak {
  if (event.name !== 'run_started' || event.evidence['persona'] !== persona) return streak;
  return { ...streak, runs: new Set([...streak.runs, event.evidence['runId']]) };
}

function next(streak: Streak, event: HarnessEvent, persona: Identity): Streak {
  if (setsHead(event)) return { ...none, runs: streak.runs };
  if (leaseLost(streak, event)) return counted(streak, event);
  if (event.actor !== persona) return streak;
  if (event.name === 'run_started') return started(streak, event, persona);
  if (event.name === 'run_failed') return counted(streak, event);
  if (event.name !== 'run_completed') return streak;
  if (!fruitless.has(event.evidence['result'])) return { ...none, runs: streak.runs };
  return counted(streak, event);
}

export function backingOff(events: readonly HarnessEvent[], persona: Identity, at: Date): boolean {
  const streak = events.reduce<Streak>((current, event) => next(current, event, persona), none);
  if (streak.last === null) return false;
  const window = Math.min(FIRST_BACKOFF_MS * 2 ** (streak.count - 1), BACKOFF_CAP_MS);
  return at.getTime() - new Date(streak.last).getTime() < window;
}

const reviewed: ReadonlySet<unknown> = new Set(['review_posted', 'review_withheld']);

function reviewedNext(done: boolean, event: HarnessEvent, persona: Identity): boolean {
  if (setsHead(event)) return false;
  if (event.actor !== persona || event.name !== 'run_completed') return done;
  return done || reviewed.has(event.evidence['result']);
}

export function reviewedAtHead(events: readonly HarnessEvent[], persona: Identity): boolean {
  return events.reduce<boolean>((done, event) => reviewedNext(done, event, persona), false);
}

export function refusedByEngine(events: readonly HarnessEvent[]): boolean {
  const refusal = events.findLastIndex(
    (event) => event.name === 'run_failed' && event.evidence['why'] === 'engine_refused',
  );
  return (
    refusal !== -1 && !events.slice(refusal + 1).some((event) => event.actor.startsWith('human:'))
  );
}
