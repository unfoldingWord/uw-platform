import { eventEvidenceSchemas, type HarnessEvent } from '@uw/contracts';
import type { StoreTransaction } from '../ports.ts';

const MICROS_PER_MINOR = 10_000;
const SPEND_READ_MOST = 5000;

export function minorOf(costMicros: number | null, ceilingMinor: number): number {
  if (costMicros === null) return ceilingMinor;
  return Math.floor((costMicros + MICROS_PER_MINOR / 2) / MICROS_PER_MINOR);
}

export function monthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

export function spentOf(events: readonly HarnessEvent[], ceilingMinor: number): number {
  const finished = eventEvidenceSchemas.assistant_turn_finished;
  return events.reduce((total, event) => {
    if (event.name !== 'assistant_turn_finished') return total;
    const parsed = finished.safeParse(event.evidence);
    const micros = parsed.success ? parsed.data.costMicros : null;
    return total + minorOf(micros, ceilingMinor);
  }, 0);
}

export async function spentThisMonth(
  tx: StoreTransaction,
  harnessId: string,
  at: Date,
  ceilingMinor: number,
): Promise<number | null> {
  const events = await tx.harnessEvents.read.recent({
    since: monthStart(at),
    names: ['assistant_turn_finished'],
    agentsOnly: false,
    limit: SPEND_READ_MOST,
    harnessIds: [harnessId],
  });
  if (events.length >= SPEND_READ_MOST) return null;
  return spentOf(events, ceilingMinor);
}
