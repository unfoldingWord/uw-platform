import type { BreakerLevel } from '@uw/contracts';
import type { BreakerEventName, StoreTransaction } from '../ports.ts';

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

export async function currentLevel(tx: StoreTransaction): Promise<BreakerLevel> {
  const latest = await tx.harnessEvents.read.latestNamed(breakerEvents, null);
  if (latest === null) return 'open';
  return levels.get(latest.name) ?? 'open';
}
