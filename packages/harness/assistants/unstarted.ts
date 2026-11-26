import { isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';

export type UnstartedInput = { readonly limit: number };
export type Unstarted = { readonly requestIds: readonly string[] };

type UnstartedPorts = Pick<Ports, 'clock' | 'store'>;

const WAIT_MS = 2 * 60_000;
const LOOK_BACK_MS = 24 * 60 * 60_000;
const READ_MOST = 200;

export async function unstartedRequests(
  ports: UnstartedPorts,
  caller: Caller,
  input: UnstartedInput,
): Promise<KernelOutcome<Unstarted>> {
  if (!isSystemPrincipal(caller.actor)) {
    return refused('not_permitted', { actor: caller.actor.identity });
  }
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > READ_MOST) {
    return refused('malformed_command', { field: 'limit' });
  }
  const at = ports.clock.now();
  const requestIds = await ports.store.transaction((tx) =>
    tx.assistantRequests.read.unstarted({
      recordedBefore: new Date(at.getTime() - WAIT_MS),
      since: new Date(at.getTime() - LOOK_BACK_MS),
      limit: input.limit,
    }),
  );
  return accepted({ requestIds });
}
