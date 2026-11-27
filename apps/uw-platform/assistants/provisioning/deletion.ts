import { ASSISTANT_DELETE_AFTER_DAYS, type AssistantProvisioningStep } from '@uw/contracts';
import { disabledSince, type AccountWork } from './rows.ts';
import type { ProvisionerDeps, StepOutcome } from './types.ts';
import { deleteUser } from './workspace-steps.ts';
import { deactivateBot } from './zulip-steps.ts';

const DAY_MS = 86_400_000;

export type Deleted = {
  readonly deleted: readonly string[];
  readonly failed: readonly string[];
};

async function failedAt(
  deps: ProvisionerDeps,
  work: AccountWork,
  step: AssistantProvisioningStep,
  outcome: StepOutcome,
): Promise<boolean> {
  if (outcome.kind !== 'failed') return false;
  const record = { harnessId: work.harnessId, step, why: outcome.why };
  await deps.kernel.assistants.recordProvisioning(deps.caller, record);
  return true;
}

async function deleted(deps: ProvisionerDeps, work: AccountWork): Promise<boolean> {
  if (await failedAt(deps, work, 'deactivate_bot', await deactivateBot(deps, work))) return false;
  if (await failedAt(deps, work, 'delete_user', await deleteUser(deps, work))) return false;
  const retired = await deps.kernel.assistants.retire(deps.caller, { harnessId: work.harnessId });
  return retired.status === 'accepted';
}

export async function deleteTurnedOff(deps: ProvisionerDeps, limit: number): Promise<Deleted> {
  const now = deps.clock.now();
  const before = new Date(now.getTime() - ASSISTANT_DELETE_AFTER_DAYS * DAY_MS);
  const result = { deleted: [] as string[], failed: [] as string[] };
  for (const work of await disabledSince(deps.db, before, limit)) {
    ((await deleted(deps, work)) ? result.deleted : result.failed).push(work.harnessId);
  }
  return result;
}
