import { harnessSchema } from '@uw/contracts';
import { isProvisionerPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { revokeLeaverAssistIn } from '../delegations/leaver-revoke.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { StoreTransaction } from '../ports.ts';
import {
  assistDelegationsOf,
  revokerAs,
  turnOffIn,
  type AccountPorts,
  type Disabled,
  type Revoker,
} from './account-lifecycle.ts';
import { orgAdminRefusal } from './org-admin.ts';

export type LeaversInput = { readonly limit: number };
export type LeaversTurnedOff = { readonly disabled: readonly Disabled[] };
export type DisableForInput = { readonly personId: string };

const LEAVERS_MOST = 50;

function revokedFor(ports: AccountPorts, caller: Caller): Revoker {
  return async (tx, row, at) => {
    let revoked = 0;
    for (const delegation of await assistDelegationsOf(tx, row, at)) {
      if (await revokeLeaverAssistIn(ports, tx, caller, delegation, at)) revoked += 1;
    }
    return revoked;
  };
}

async function leaversIn(
  ports: AccountPorts,
  tx: StoreTransaction,
  caller: Caller,
  limit: number,
): Promise<KernelOutcome<LeaversTurnedOff>> {
  const revoke = revokedFor(ports, caller);
  const disabled: Disabled[] = [];
  for (const row of await tx.assistantAccounts.read.leavers(limit)) {
    const outcome = await turnOffIn(ports, tx, caller, row.personId, revoke);
    if (outcome.status === 'accepted') disabled.push(outcome.value);
  }
  return accepted({ disabled });
}

export function disableLeavers(
  ports: AccountPorts,
  caller: Caller,
  input: LeaversInput,
): Promise<KernelOutcome<LeaversTurnedOff>> {
  if (!isProvisionerPrincipal(caller.actor)) {
    return Promise.resolve(refused('not_permitted', { actor: caller.actor.identity }));
  }
  const limit = Math.max(1, Math.min(LEAVERS_MOST, Math.trunc(input.limit)));
  return ports.store.transaction((tx) => leaversIn(ports, tx, caller, limit));
}

function personRefusal(input: DisableForInput): Refused | null {
  return harnessSchema.shape.id.safeParse(input.personId).success
    ? null
    : refused('malformed_command', { field: 'personId' });
}

export function disableFor(
  ports: AccountPorts,
  caller: Caller,
  input: DisableForInput,
): Promise<KernelOutcome<Disabled>> {
  const malformed = personRefusal(input);
  if (malformed !== null) return Promise.resolve(malformed);
  return ports.store.transaction(async (tx) => {
    const denied = await orgAdminRefusal(ports, tx, caller, ports.clock.now());
    if (denied !== null) return denied;
    return turnOffIn(ports, tx, caller, input.personId, revokerAs(ports, caller));
  });
}
