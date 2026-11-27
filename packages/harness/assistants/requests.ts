import {
  assistantRequestInputSchema,
  type AssistantRequestInput,
  type Harness,
  type UntrustedPart,
} from '@uw/contracts';
import { isIngestPrincipal, isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import { storeRefusalOf } from '../port-errors.ts';
import type { AssistantRequestRow, Ports, StoreTransaction } from '../ports.ts';

export type RequestInput = Omit<AssistantRequestInput, 'untrustedParts'> & {
  readonly untrustedParts: readonly UntrustedPart[];
};
export type RecordedRequest = { readonly requestId: string; readonly created: boolean };

type RequestPorts = Pick<Ports, 'clock' | 'ids' | 'store'>;

const EXTERNAL_ONCE = 'assistant_requests_external_once';
const REQUESTS_PER_HOUR = 30;
const HOUR_MS = 60 * 60_000;

function existing(harness: Harness, found: AssistantRequestRow): KernelOutcome<RecordedRequest> {
  if (found.harnessId !== harness.id) {
    return refused('not_permitted', { why: 'external_id_elsewhere' });
  }
  return accepted({ requestId: found.id, created: false });
}

function rowOf(
  ports: RequestPorts,
  harness: Harness,
  input: AssistantRequestInput,
  at: Date,
): AssistantRequestRow {
  return {
    id: ports.ids.next(),
    harnessId: harness.id,
    personId: input.personId,
    channel: input.channel,
    externalId: input.externalId,
    threadKey: input.threadKey,
    replyAddress: input.replyAddress,
    note: input.note,
    untrustedParts: input.untrustedParts.map((part) => ({ ...part })),
    receivedAt: new Date(input.receivedAt),
    recordedAt: at,
  };
}

async function recordIn(
  ports: RequestPorts,
  tx: StoreTransaction,
  caller: Caller,
  input: AssistantRequestInput,
  at: Date,
): Promise<KernelOutcome<RecordedRequest>> {
  const harness = await tx.harnesses.read.byPerson(input.personId);
  if (harness === null) return refused('no_assistant', { personId: input.personId });
  const found = await tx.assistantRequests.read.byExternal(input.channel, input.externalId);
  if (found !== null) return existing(harness, found);
  const since = new Date(at.getTime() - HOUR_MS);
  if ((await tx.assistantRequests.read.countSince(harness.id, since)) >= REQUESTS_PER_HOUR) {
    return refused('not_permitted', { why: 'requests_capped' });
  }
  const row = rowOf(ports, harness, input, at);
  await tx.assistantRequests.write.insert(row);
  await recordHarnessEvents(tx, recordContext(ports, caller, at), harness.id, [
    draft('assistant_request_recorded', { requestId: row.id, channel: row.channel }),
  ]);
  return accepted({ requestId: row.id, created: true });
}

function callerRefusal(caller: Caller): Refused | null {
  const { actor } = caller;
  return isIngestPrincipal(actor) || isSystemPrincipal(actor)
    ? null
    : refused('not_permitted', { actor: actor.identity });
}

export async function recordRequest(
  ports: RequestPorts,
  caller: Caller,
  input: RequestInput,
): Promise<KernelOutcome<RecordedRequest>> {
  const denied = callerRefusal(caller);
  if (denied !== null) return denied;
  const parsed = assistantRequestInputSchema.safeParse(input);
  if (!parsed.success) return refused('malformed_command', { why: 'assistant_request' });
  const at = ports.clock.now();
  try {
    return await ports.store.transaction((tx) => recordIn(ports, tx, caller, parsed.data, at));
  } catch (error) {
    if (storeRefusalOf(error)?.constraint !== EXTERNAL_ONCE) throw error;
    return ports.store.transaction((tx) => recordIn(ports, tx, caller, parsed.data, at));
  }
}
