import {
  addCommitmentCommandSchema,
  removeCommitmentCommandSchema,
  removeStaffAllocationCommandSchema,
  setStaffAllocationCommandSchema,
} from '@uw/contracts';
import type { ZodType } from 'zod';

type Given = ReadonlyMap<string, string>;
type Shape = (given: Given) => Readonly<Record<string, unknown>>;

function given(raw: string | undefined): string | null {
  const trimmed = raw?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function percentOf(raw: string | undefined): number | null {
  const text = given(raw);
  return text === null ? null : Number(text);
}

function targetOf(raw: string | undefined): Readonly<Record<string, string>> {
  const [kind = '', pageId = ''] = (raw ?? '').split(':');
  return { kind, pageId };
}

export const teamSchemas: ReadonlyMap<string, ZodType> = new Map<string, ZodType>([
  ['add_commitment', addCommitmentCommandSchema],
  ['remove_commitment', removeCommitmentCommandSchema],
  ['set_staff_allocation', setStaffAllocationCommandSchema],
  ['remove_staff_allocation', removeStaffAllocationCommandSchema],
]);

export const teamShapes: ReadonlyMap<string, Shape> = new Map<string, Shape>([
  [
    'add_commitment',
    (fields) => ({
      fromPersonId: fields.get('fromPersonId'),
      toPersonId: given(fields.get('toPersonId')),
      toText: given(fields.get('toText')),
    }),
  ],
  ['remove_commitment', (fields) => ({ commitmentId: fields.get('commitmentId') })],
  [
    'set_staff_allocation',
    (fields) => ({
      personId: fields.get('personId'),
      target: targetOf(fields.get('target')),
      percent: percentOf(fields.get('percent')),
    }),
  ],
  ['remove_staff_allocation', (fields) => ({ allocationId: fields.get('allocationId') })],
]);
