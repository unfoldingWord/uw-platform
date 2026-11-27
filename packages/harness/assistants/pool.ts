import type { KernelSettings } from '../kernel-settings.ts';
import { lockKeys } from '../lock-keys.ts';
import type { AssistantPoolBudgets, StoreTransaction } from '../ports.ts';
import { assistantRole } from './role.ts';
import { budgetSpent, monthStart } from './spend.ts';

function poolMinorOf(budgets: AssistantPoolBudgets, ceilingMinor: number | null): number {
  const defaulted = budgets.enabled - budgets.overridden;
  const summed = budgets.overriddenMinor + defaulted * assistantRole.budget.monthly_minor;
  return ceilingMinor === null ? summed : Math.min(summed, ceilingMinor);
}

export async function poolSpent(
  tx: StoreTransaction,
  settings: Pick<KernelSettings, 'assistantSpendCapMinor'>,
  at: Date,
): Promise<boolean> {
  await tx.lock(lockKeys.assistantPool());
  const since = monthStart(at);
  const budgets = await tx.assistantBudgets.read.pool(at, since);
  const spend = await tx.harnessEvents.read.assistantPoolSpend(since);
  const poolMinor = poolMinorOf(budgets, settings.assistantSpendCapMinor);
  return budgetSpent(spend, assistantRole.turnCeilingMinor, poolMinor);
}

export async function monthlyMinorOf(
  tx: StoreTransaction,
  harnessId: string,
  personaMinor: number,
): Promise<number> {
  const set = await tx.assistantBudgets.read.of(harnessId);
  return set === null ? personaMinor : set.monthlyMinor;
}
