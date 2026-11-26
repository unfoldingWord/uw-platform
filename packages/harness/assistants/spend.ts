import type { AssistantMonthSpend, StoreTransaction } from '../ports.ts';

const MICROS_PER_MINOR = 10_000;

export function monthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

export function spentMicros(spend: AssistantMonthSpend, ceilingMinor: number): number {
  const atCeiling = spend.unknownTurns + spend.openTurns;
  return spend.knownMicros + atCeiling * ceilingMinor * MICROS_PER_MINOR;
}

export function budgetSpent(
  spend: AssistantMonthSpend,
  ceilingMinor: number,
  monthlyMinor: number,
): boolean {
  return spentMicros(spend, ceilingMinor) >= monthlyMinor * MICROS_PER_MINOR;
}

export function spendThisMonth(
  tx: StoreTransaction,
  harnessId: string,
  at: Date,
): Promise<AssistantMonthSpend> {
  return tx.harnessEvents.read.assistantSpend({ harnessId, since: monthStart(at) });
}
