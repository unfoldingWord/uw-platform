import type { HealthIndicator, IndicatorStatus } from '@uw/contracts';
import { formatDuration } from '@uw/core/dates';
import { formatCount } from '@uw/core/money';
import type { Holds, Silence, SilenceLevel } from '@uw/harness';

export const BALL_INDICATORS = ['silence_alarm', 'held_by_person', 'held_by_agent'] as const;
type HeldName = 'held_by_person' | 'held_by_agent';

const DETAIL_LIMIT = 200;
const ranks: Readonly<Record<SilenceLevel, number>> = { ok: 0, amber: 1, red: 2 };
type HoldWords = { readonly noun: string; readonly limit: string };
const personWords: HoldWords = { noun: 'with a person', limit: '24 hours' };
const agentWords: HoldWords = { noun: 'with an agent', limit: '2 hours' };

function botWords(uncounted: number): string {
  return uncounted === 0 ? '' : `; not counting ${formatCount(uncounted)} by bot accounts`;
}

function loudest(found: readonly Silence[]): Silence | null {
  let worst: Silence | null = null;
  for (const silence of found) {
    if (worst === null || ranks[silence.level] > ranks[worst.level]) worst = silence;
  }
  return worst;
}

function quietFor(worst: Silence, at: Date): string {
  const last = worst.lastReviewStepAt;
  return last === null ? 'over 90 minutes' : formatDuration(at.getTime() - last.getTime());
}

export function silenceIndicator(found: readonly Silence[], at: Date): HealthIndicator {
  const bots = botWords(found.reduce((sum, silence) => sum + silence.uncounted, 0));
  const worst = loudest(found);
  if (worst === null || worst.level === 'ok') {
    const detail = `No item has waited in Check over 45 minutes without a review step${bots}`;
    return { name: 'silence_alarm', status: 'ok', detail: detail.slice(0, DETAIL_LIMIT) };
  }
  const loud = found.filter((silence) => silence.level !== 'ok');
  const oldest = Math.min(...worst.waiting.map((entry) => entry.enteredAt.getTime()));
  const waiting = loud.reduce((sum, silence) => sum + silence.waiting.length, 0);
  const longest = formatDuration(at.getTime() - oldest);
  const detail = `${formatCount(waiting)} waiting in Check, the longest ${longest} on ${worst.harness.key}, with no review step for ${quietFor(worst, at)}${bots}`;
  return { name: 'silence_alarm', status: worst.level, detail: detail.slice(0, DETAIL_LIMIT) };
}

export function heldIndicator(name: HeldName, holds: Holds): HealthIndicator {
  const person = name === 'held_by_person';
  const { noun, limit } = person ? personWords : agentWords;
  const rows = person ? holds.person : holds.agent;
  const uncounted = person ? holds.uncounted.person : holds.uncounted.agent;
  const count = holds.capped ? `At least ${formatCount(rows.length)}` : formatCount(rows.length);
  const head =
    rows.length === 0
      ? `None over ${limit}`
      : `${count} ${rows.length === 1 ? 'item' : 'items'} ${noun} over ${limit}`;
  const status: IndicatorStatus = rows.length === 0 && !holds.capped ? 'ok' : 'amber';
  return { name, status, detail: `${head}${botWords(uncounted)}`.slice(0, DETAIL_LIMIT) };
}
