import { ASSISTANT_BUDGET_MOST_MINOR, harnessSchema } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { orgAdminRefusal } from './org-admin.ts';

export type SetBudgetInput = { readonly personId: string; readonly monthlyMinor: number | null };
export type BudgetSet = { readonly harnessId: string; readonly monthlyMinor: number | null };

type BudgetPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

const uuid = harnessSchema.shape.id;

function inputRefusal(input: SetBudgetInput): Refused | null {
  if (!uuid.safeParse(input.personId).success) {
    return refused('malformed_command', { field: 'personId' });
  }
  const amount = input.monthlyMinor;
  if (amount === null) return null;
  const bounded = Number.isSafeInteger(amount) && amount >= 0;
  return bounded && amount <= ASSISTANT_BUDGET_MOST_MINOR
    ? null
    : refused('malformed_command', { field: 'monthlyMinor' });
}

export async function setBudget(
  ports: BudgetPorts,
  caller: Caller,
  input: SetBudgetInput,
): Promise<KernelOutcome<BudgetSet>> {
  const malformed = inputRefusal(input);
  if (malformed !== null) return malformed;
  const context = recordContext(ports, caller, ports.clock.now());
  return ports.store.transaction(async (tx) => {
    const denied = await orgAdminRefusal(ports, tx, caller, context.at);
    if (denied !== null) return denied;
    const harness = await tx.harnesses.read.byPerson(input.personId);
    if (harness === null) return refused('harness_not_found', { personId: input.personId });
    await tx.lock(lockKeys.assistantHarness(harness.id));
    const { monthlyMinor } = input;
    if (monthlyMinor === null) await tx.assistantBudgets.write.remove(harness.id);
    else {
      const setBy = caller.actor.personId ?? '';
      const row = { harnessId: harness.id, personId: input.personId, monthlyMinor };
      await tx.assistantBudgets.write.put({ ...row, setBy, setAt: context.at });
    }
    await recordHarnessEvents(tx, context, harness.id, [
      draft('assistant_budget_set', { monthlyMinor }),
    ]);
    return accepted({ harnessId: harness.id, monthlyMinor });
  });
}
