import type { SetAssistantBudgetCommand } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import type { Principal } from '@uw/core/principal';
import type { CommandResult } from '../http/commands.ts';
import { platformKernel } from '../kernel.ts';

export async function setAssistantBudget(
  db: Database,
  actor: Principal,
  command: SetAssistantBudgetCommand,
  traceId: string,
  at: Date,
): Promise<CommandResult> {
  const handle = { db, ping: () => Promise.resolve(), release: () => Promise.resolve() };
  const kernel = platformKernel(handle, { now: () => at });
  const outcome = await kernel.assistants.setBudget(
    { actor, traceId, requestId: command.requestId },
    { personId: command.personId, monthlyMinor: command.monthlyMinor },
  );
  return outcome.status === 'accepted' ? { ok: true } : { ok: false, reason: outcome.reason };
}
