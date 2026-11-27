import { z } from 'zod';

export const COMMITMENT_TEXT_MOST = 200;

export const allocationTargetKindSchema = z.enum(['program', 'portfolio']);

const commitmentText = z
  .string()
  .max(COMMITMENT_TEXT_MOST)
  .refine((text) => text.trim() !== '', 'a commitment names someone');

export const addCommitmentCommandSchema = z
  .strictObject({
    command: z.literal('add_commitment'),
    requestId: z.uuid(),
    fromPersonId: z.uuid(),
    toPersonId: z.uuid().nullable(),
    toText: commitmentText.nullable(),
  })
  .refine((command) => (command.toPersonId === null) !== (command.toText === null), {
    message: 'a commitment names a person or a text, exactly one',
    path: ['toText'],
  });

export const removeCommitmentCommandSchema = z.strictObject({
  command: z.literal('remove_commitment'),
  requestId: z.uuid(),
  commitmentId: z.uuid(),
});

export const setStaffAllocationCommandSchema = z.strictObject({
  command: z.literal('set_staff_allocation'),
  requestId: z.uuid(),
  personId: z.uuid(),
  target: z.strictObject({ kind: allocationTargetKindSchema, pageId: z.uuid() }),
  percent: z.number().int().min(0).max(100).nullable(),
});

export const removeStaffAllocationCommandSchema = z.strictObject({
  command: z.literal('remove_staff_allocation'),
  requestId: z.uuid(),
  allocationId: z.uuid(),
});

export type AllocationTargetKind = z.infer<typeof allocationTargetKindSchema>;
export type AddCommitmentCommand = z.infer<typeof addCommitmentCommandSchema>;
export type RemoveCommitmentCommand = z.infer<typeof removeCommitmentCommandSchema>;
export type SetStaffAllocationCommand = z.infer<typeof setStaffAllocationCommandSchema>;
export type RemoveStaffAllocationCommand = z.infer<typeof removeStaffAllocationCommandSchema>;
