import { ASSISTANT_RETENTION_DAYS, type AssistantRedactionWhy } from '@uw/contracts';
import { isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents, type RecordContext } from '../items/record.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, RedactQuery, StoreTransaction } from '../ports.ts';
import { actingPerson } from './accounts.ts';
import { ownedHarness } from './settings.ts';

export type RedactInput = Record<string, never>;
export type Redacted = { readonly requests: number; readonly done: boolean };

type RedactPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;
type Sweep = {
  readonly harnessId: string | null;
  readonly before: Date;
  readonly why: AssistantRedactionWhy;
};
type Batch = { readonly requests: number; readonly full: boolean };

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 500;
const BATCHES_MOST = 20;

function countsBy(harnessIds: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const id of harnessIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

async function batchIn(tx: StoreTransaction, context: RecordContext, sweep: Sweep): Promise<Batch> {
  const query: RedactQuery = { ...sweep, at: context.at, limit: BATCH };
  const requests = await tx.assistantRequests.write.redact(query);
  await tx.assistantEffects.write.redactFor(
    requests.map((row) => row.id),
    context.at,
  );
  const reminders = await tx.assistantReminders.write.redact(query);
  const holds = await tx.assistantHolds.write.redact(query);
  const proposals = await tx.assistantProposals.write.redact(query);
  for (const [harnessId, count] of countsBy(requests.map((row) => row.harnessId))) {
    await recordHarnessEvents(tx, context, harnessId, [
      draft('assistant_history_redacted', { why: sweep.why, requests: count }),
    ]);
  }
  const full = [requests.length, reminders, holds, proposals].some((count) => count === BATCH);
  return { requests: requests.length, full };
}

async function sweepAll(ports: RedactPorts, caller: Caller, sweep: Sweep): Promise<Redacted> {
  let requests = 0;
  for (let batch = 0; batch < BATCHES_MOST; batch += 1) {
    const context = recordContext(ports, caller, ports.clock.now());
    const done = await ports.store.transaction((tx) => batchIn(tx, context, sweep));
    requests += done.requests;
    if (!done.full) return { requests, done: true };
  }
  return { requests, done: false };
}

async function personSweep(ports: RedactPorts, caller: Caller, at: Date): Promise<Sweep | Refused> {
  const personId = actingPerson(caller);
  if (typeof personId !== 'string') return personId;
  return ports.store.transaction(async (tx) => {
    const harness = await tx.harnesses.read.byPerson(personId);
    if (harness === null) return refused('no_assistant');
    const owned = await ownedHarness(ports, tx, caller, harness.id, at);
    if ('status' in owned) return owned;
    return { harnessId: owned.harnessId, before: new Date(at.getTime() + 1), why: 'person' };
  });
}

export async function redactHistory(
  ports: RedactPorts,
  caller: Caller,
): Promise<KernelOutcome<Redacted>> {
  const at = ports.clock.now();
  if (isSystemPrincipal(caller.actor)) {
    const before = new Date(at.getTime() - ASSISTANT_RETENTION_DAYS * DAY_MS);
    return accepted(await sweepAll(ports, caller, { harnessId: null, before, why: 'retention' }));
  }
  const sweep = await personSweep(ports, caller, at);
  if ('status' in sweep) return sweep;
  return accepted(await sweepAll(ports, caller, sweep));
}
