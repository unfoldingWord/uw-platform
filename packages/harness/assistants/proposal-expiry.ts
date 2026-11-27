import { isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';

export type ExpireInput = { readonly limit: number };
export type Expired = { readonly expired: readonly string[] };

type ExpirePorts = Pick<Ports, 'clock' | 'ids' | 'store'>;

const EXPIRE_MOST = 200;

export async function expireProposals(
  ports: ExpirePorts,
  caller: Caller,
  input: ExpireInput,
): Promise<KernelOutcome<Expired>> {
  if (!isSystemPrincipal(caller.actor)) {
    return refused('not_permitted', { actor: caller.actor.identity });
  }
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > EXPIRE_MOST) {
    return refused('malformed_command', { field: 'limit' });
  }
  const context = recordContext(ports, caller, ports.clock.now());
  const due = await ports.store.transaction((tx) =>
    tx.assistantProposals.read.expiring(context.at, input.limit),
  );
  const expired: string[] = [];
  for (const proposal of due) {
    const done = await ports.store.transaction(async (tx) => {
      await tx.lock(lockKeys.assistantHarness(proposal.harnessId));
      if (!(await tx.assistantProposals.write.expire({ id: proposal.id, at: context.at }))) {
        return false;
      }
      await recordHarnessEvents(tx, context, proposal.harnessId, [
        draft('assistant_proposal_expired', { proposalId: proposal.id }),
      ]);
      return true;
    });
    if (done) expired.push(proposal.id);
  }
  return accepted({ expired });
}
