import {
  ASSISTANT_DELETE_AFTER_DAYS,
  assistantIdentityOf,
  assistantProvisioningFailureSchema,
  assistantProvisioningStepSchema,
  harnessSchema,
  type AssistantProvisioningFailure,
  type AssistantProvisioningStep,
} from '@uw/contracts';
import { isProvisionerPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { revokeIn } from '../delegations/commands.ts';
import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { AssistantAccountRow, Ports, StoreTransaction } from '../ports.ts';
import { actingPerson } from './accounts.ts';

type AccountPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type Disabled = { readonly harnessId: string; readonly revoked: number };
export type RetireInput = { readonly harnessId: string };
export type Retired = { readonly harnessId: string; readonly jdId: string };
export type ProvisioningRecord =
  | { readonly harnessId: string; readonly done: 'enabled' | 'disabled' }
  | {
      readonly harnessId: string;
      readonly step: AssistantProvisioningStep;
      readonly why: AssistantProvisioningFailure;
    };

const DAY_MS = 86_400_000;
const LIVE_READ_MOST = 20;

async function revokeAssist(
  ports: AccountPorts,
  tx: StoreTransaction,
  caller: Caller,
  row: AssistantAccountRow,
  at: Date,
): Promise<number> {
  const filter = {
    personId: row.personId,
    persona: assistantIdentityOf(row.personId),
    harnessId: row.harnessId,
  };
  const live = await tx.delegations.read.firstLive(filter, at, LIVE_READ_MOST);
  let revoked = 0;
  for (const delegation of live.filter((one) => one.capability === 'assist')) {
    const outcome = await revokeIn(ports, tx, caller, delegation.id, at);
    if (outcome.status === 'accepted') revoked += 1;
  }
  return revoked;
}

async function disableIn(
  ports: AccountPorts,
  tx: StoreTransaction,
  caller: Caller,
  personId: string,
): Promise<KernelOutcome<Disabled>> {
  const at = ports.clock.now();
  await tx.lock(lockKeys.assistantJdAllocation());
  const row = await tx.assistantAccounts.read.byPerson(personId);
  if (row === null || row.status === 'deleted') return refused('no_assistant');
  if (row.status === 'disabled') return accepted({ harnessId: row.harnessId, revoked: 0 });
  const next = { ...row, status: 'disabled', disabledAt: at, version: row.version + 1 } as const;
  if (!(await tx.assistantAccounts.write.update({ ...next, updatedAt: at }, row.version))) {
    return refused('stale_version', { harnessId: row.harnessId });
  }
  await tx.lock(lockKeys.assistantHarness(row.harnessId));
  const revoked = await revokeAssist(ports, tx, caller, row, at);
  await recordHarnessEvents(tx, recordContext(ports, caller, at), row.harnessId, [
    draft('assistant_disabled', { revoked }),
  ]);
  return accepted({ harnessId: row.harnessId, revoked });
}

export async function disable(
  ports: AccountPorts,
  caller: Caller,
): Promise<KernelOutcome<Disabled>> {
  const personId = actingPerson(caller);
  if (typeof personId !== 'string') return personId;
  return ports.store.transaction((tx) => disableIn(ports, tx, caller, personId));
}

function provisionerRefusal(caller: Caller, harnessId: unknown): Refused | null {
  if (!isProvisionerPrincipal(caller.actor)) {
    return refused('not_permitted', { actor: caller.actor.identity });
  }
  if (!harnessSchema.shape.id.safeParse(harnessId).success) {
    return refused('malformed_command', { field: 'harnessId' });
  }
  return null;
}

function due(row: AssistantAccountRow, at: Date): boolean {
  const since = row.disabledAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return row.status === 'disabled' && at.getTime() - since >= ASSISTANT_DELETE_AFTER_DAYS * DAY_MS;
}

export async function retire(
  ports: AccountPorts,
  caller: Caller,
  input: RetireInput,
): Promise<KernelOutcome<Retired>> {
  const denied = provisionerRefusal(caller, input.harnessId);
  if (denied !== null) return denied;
  const at = ports.clock.now();
  return ports.store.transaction(async (tx) => {
    await tx.lock(lockKeys.assistantJdAllocation());
    const row = await tx.assistantAccounts.read.byHarness(input.harnessId);
    if (row === null) return refused('no_assistant');
    if (row.jdId === null || !due(row, at)) return refused('not_permitted', { why: 'not_due' });
    const gone = { ...row, status: 'deleted', jdId: null, deletedAt: at } as const;
    const next = { ...gone, version: row.version + 1, updatedAt: at };
    if (!(await tx.assistantAccounts.write.update(next, row.version))) {
      return refused('stale_version', { harnessId: row.harnessId });
    }
    await recordHarnessEvents(tx, recordContext(ports, caller, at), row.harnessId, [
      draft('assistant_deleted', { jdId: row.jdId }),
    ]);
    return accepted({ harnessId: row.harnessId, jdId: row.jdId });
  });
}

function recordOf(input: ProvisioningRecord) {
  if ('done' in input) {
    const goal = input.done === 'disabled' ? 'disabled' : 'enabled';
    return draft('assistant_provisioned', { goal });
  }
  const step = assistantProvisioningStepSchema.safeParse(input.step);
  const why = assistantProvisioningFailureSchema.safeParse(input.why);
  if (!step.success || !why.success) return null;
  return draft('assistant_provisioning_failed', { step: step.data, why: why.data });
}

export async function recordProvisioning(
  ports: AccountPorts,
  caller: Caller,
  input: ProvisioningRecord,
): Promise<KernelOutcome<null>> {
  const denied = provisionerRefusal(caller, input.harnessId);
  if (denied !== null) return denied;
  const event = recordOf(input);
  if (event === null) return refused('malformed_command', { field: 'step' });
  const at = ports.clock.now();
  return ports.store.transaction(async (tx) => {
    const row = await tx.assistantAccounts.read.byHarness(input.harnessId);
    if (row === null) return refused('no_assistant');
    await recordHarnessEvents(tx, recordContext(ports, caller, at), row.harnessId, [event]);
    return accepted(null);
  });
}
