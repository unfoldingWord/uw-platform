import type { BreakerLevel, HarnessEvent } from '@uw/contracts';
import { refused, type Refused } from '../outcome.ts';
import type { BreakerEventName, StoreTransaction } from '../ports.ts';

const BREAKER_STALE_MS = 10 * 60 * 1000;

const levels: ReadonlyMap<string, BreakerLevel> = new Map<BreakerEventName, BreakerLevel>([
  ['breaker_open', 'open'],
  ['breaker_holding', 'holding'],
  ['breaker_pausing', 'pausing'],
]);

const breakerEvents: readonly BreakerEventName[] = [
  'breaker_open',
  'breaker_holding',
  'breaker_pausing',
];

export function levelOfEvent(event: HarnessEvent | null): BreakerLevel {
  if (event === null) return 'open';
  return levels.get(event.name) ?? 'open';
}

export function latestReading(
  tx: StoreTransaction,
  harnessId: string | null,
): Promise<HarnessEvent | null> {
  return tx.harnessEvents.read.latestNamed(breakerEvents, harnessId);
}

export async function currentLevel(tx: StoreTransaction): Promise<BreakerLevel> {
  return levelOfEvent(await latestReading(tx, null));
}

export async function spendRefusal(tx: StoreTransaction, at: Date): Promise<Refused | null> {
  const latest = await latestReading(tx, null);
  if (latest === null) return refused('spend_held', { level: 'open', why: 'no_reading' });
  const level = levelOfEvent(latest);
  if (level !== 'open') return refused('spend_held', { level });
  const age = at.getTime() - new Date(latest.at).getTime();
  return age < BREAKER_STALE_MS ? null : refused('spend_held', { level, why: 'no_fresh_reading' });
}
