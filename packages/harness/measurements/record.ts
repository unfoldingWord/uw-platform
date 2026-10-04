import { formatDate } from '@uw/core/dates';
import { allowed, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordItemEvents } from '../items/record.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { MeasurementRow, Ports, StoreTransaction } from '../ports.ts';

type MeasurementPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type RecordMeasurementInput = {
  readonly itemId: string;
  readonly source: MeasurementRow['source'];
  readonly name: string;
  readonly value: number;
  readonly asOf: string;
};

type Recording = {
  readonly caller: Caller;
  readonly input: RecordMeasurementInput;
  readonly at: Date;
};

function inputRefusal(input: RecordMeasurementInput, at: Date): Refused | null {
  if (input.name.trim().length === 0) return refused('malformed_command', { why: 'blank_name' });
  if (!Number.isFinite(input.value)) return refused('malformed_command', { why: 'not_finite' });
  if (input.asOf > formatDate(at)) return refused('malformed_command', { asOf: input.asOf });
  return null;
}

async function standingRefusal(
  ports: MeasurementPorts,
  tx: StoreTransaction,
  { caller, input, at }: Recording,
  harnessId: string,
): Promise<Refused | null> {
  const harness = await tx.harnesses.read.byId(harnessId);
  const personId = caller.actor.personId;
  if (harness === null || personId === null) {
    return refused('item_not_found', { itemId: input.itemId });
  }
  const grants = await ports.grants.resolveIn(tx, personId, at);
  const actor = { ...caller.actor, grants: [...grants] };
  if (!allowed(actor, 'read', harness, at)) {
    return refused('item_not_found', { itemId: input.itemId });
  }
  if (!allowed(actor, 'write', harness, at)) {
    return refused('not_permitted', { harnessId: harness.id });
  }
  return null;
}

async function recordIn(
  ports: MeasurementPorts,
  tx: StoreTransaction,
  recording: Recording,
): Promise<KernelOutcome<MeasurementRow>> {
  const { caller, input, at } = recording;
  const item = await tx.harnessItems.read.lock(input.itemId);
  if (item === null) return refused('item_not_found', { itemId: input.itemId });
  const denied = await standingRefusal(ports, tx, recording, item.harnessId);
  if (denied !== null) return denied;
  const stages = await tx.harnessStages.read.forHarness(item.harnessId);
  const stage = stages.find((entry) => entry.key === item.stageKey);
  if (stage?.bracket !== 'iterate') return refused('not_permitted', { why: 'not_at_iterate' });
  const malformed = inputRefusal(input, at);
  if (malformed !== null) return malformed;
  const row: MeasurementRow = {
    id: ports.ids.next(),
    harnessId: item.harnessId,
    itemId: item.itemId,
    source: input.source,
    name: input.name.trim(),
    value: input.value,
    asOf: input.asOf,
    recordedAt: at,
  };
  await tx.measurements.write.insert(row);
  await recordItemEvents(tx, recordContext(ports, caller, at), item.itemId, [
    draft('measurement_recorded', { measurementId: row.id, ...evidenceOf(row) }),
  ]);
  return accepted(row);
}

function evidenceOf(row: MeasurementRow) {
  return { source: row.source, name: row.name, value: row.value, asOf: row.asOf };
}

export function recordMeasurement(
  ports: MeasurementPorts,
  caller: Caller,
  input: RecordMeasurementInput,
): Promise<KernelOutcome<MeasurementRow>> {
  const at = ports.clock.now();
  if (isAgent(caller.actor)) {
    return Promise.resolve(refused('not_permitted', { actor: caller.actor.identity }));
  }
  return ports.store.transaction((tx) => recordIn(ports, tx, { caller, input, at }));
}
