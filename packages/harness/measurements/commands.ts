import type { Caller } from '../caller.ts';
import type { KernelOutcome } from '../outcome.ts';
import type { MeasurementRow, Ports } from '../ports.ts';
import { recordMeasurement, type RecordMeasurementInput } from './record.ts';

export type MeasurementCommands = {
  record(caller: Caller, input: RecordMeasurementInput): Promise<KernelOutcome<MeasurementRow>>;
};

export function createMeasurementCommands(
  ports: Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>,
): MeasurementCommands {
  return { record: (caller, input) => recordMeasurement(ports, caller, input) };
}
