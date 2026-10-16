import type { HarnessEvent, RunShape } from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import { platformIdentity } from '../access.ts';
import type { RunCount, StoreTransaction } from '../ports.ts';
import { refuteNames, refuteSince, refuteTallies } from './refutes.ts';
import { PLANE_LIMIT, type PlaneTotals } from './types.ts';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export const refusalNames = ['ship_refused', 'gate_refused_to_agent'] as const;

export function monthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

export function dayStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

export function weekBefore(at: Date): Date {
  return new Date(at.getTime() - WEEK_MS);
}

export function dayBefore(at: Date): Date {
  return new Date(at.getTime() - DAY_MS);
}

export function refusalReasons(event: HarnessEvent): readonly string[] {
  if (event.name === 'gate_refused_to_agent') return ['gate_refused_to_agent'];
  const reasons = event.evidence['reasons'];
  if (!Array.isArray(reasons)) return [];
  return reasons.filter((reason): reason is string => typeof reason === 'string');
}

export function agentWrite(event: HarnessEvent): boolean {
  return !platformIdentity(event.actor);
}

function tally<K extends string>(entries: readonly (readonly [K, number])[]): Map<K, number> {
  const totals = new Map<K, number>();
  for (const [key, count] of entries) totals.set(key, (totals.get(key) ?? 0) + count);
  return totals;
}

function runsToday(counts: readonly RunCount[], since: Date): PlaneTotals['runsToday'] {
  const shapes = tally(counts.map((row) => [row.runShape, row.count] as const));
  const byShape: Record<RunShape, number> = {
    'workflow-run': shapes.get('workflow-run') ?? 0,
    'external-run': shapes.get('external-run') ?? 0,
  };
  const engines = tally(counts.map((row) => [row.engine, row.count] as const));
  return { byShape, byEngine: Object.fromEntries(engines), since };
}

function countReasons(events: readonly HarnessEvent[]): Readonly<Record<string, number>> {
  const reasons = events.flatMap(refusalReasons).map((reason) => [reason, 1] as const);
  return Object.fromEntries(tally(reasons));
}

async function liveDelegations(
  tx: StoreTransaction,
  at: Date,
): Promise<PlaneTotals['liveDelegations']> {
  const filter = { personId: null, persona: null, harnessId: null };
  const live = await tx.delegations.read.live(filter, at);
  const expiries = live.map((delegation) => delegation.expiresAt.getTime());
  const soonest = expiries.length === 0 ? null : new Date(Math.min(...expiries));
  const merge = live.filter((delegation) => delegation.capability === 'merge').length;
  return { count: live.length, merge, soonestExpiry: soonest };
}

async function eventTotals(tx: StoreTransaction, at: Date) {
  const refusals = await tx.harnessEvents.read.recent({
    since: weekBefore(at),
    names: refusalNames,
    agentsOnly: false,
    limit: PLANE_LIMIT,
  });
  const writes = await tx.harnessEvents.read.recent({
    since: dayBefore(at),
    names: null,
    agentsOnly: true,
    limit: PLANE_LIMIT,
  });
  return {
    gateRefusals: { byReason: countReasons(refusals), capped: refusals.length === PLANE_LIMIT },
    agentWrites: { count: writes.filter(agentWrite).length, capped: writes.length === PLANE_LIMIT },
  };
}

async function refuteTotals(
  tx: StoreTransaction,
  at: Date,
): Promise<PlaneTotals['reviewerRefutes']> {
  const events = await tx.harnessEvents.read.recent({
    since: refuteSince(at),
    names: refuteNames,
    agentsOnly: false,
    limit: PLANE_LIMIT,
  });
  const keys = new Map<string, string>();
  const tallies = [];
  for (const tally of refuteTallies(events)) {
    const key = keys.get(tally.harnessId) ?? (await tx.harnesses.read.byId(tally.harnessId))?.key;
    keys.set(tally.harnessId, key ?? tally.harnessId);
    tallies.push({ ...tally, harnessKey: key ?? tally.harnessId });
  }
  return { tallies, capped: events.length === PLANE_LIMIT };
}

export async function planeTotals(tx: StoreTransaction, at: Date): Promise<PlaneTotals> {
  const month = monthStart(at);
  const today = dayStart(at);
  const spend = await tx.harnessRuns.read.spendSince(month);
  const counts = await tx.harnessRuns.read.runCountsSince(today);
  const stale = await tx.pages.read.staleLearnings(formatDate(at), PLANE_LIMIT);
  return {
    at,
    spend: { ...spend, currency: 'USD', since: month },
    runsToday: runsToday(counts, today),
    liveDelegations: await liveDelegations(tx, at),
    ...(await eventTotals(tx, at)),
    staleLearnings: { count: stale.length, capped: stale.length === PLANE_LIMIT },
    reviewerRefutes: await refuteTotals(tx, at),
  };
}
