import { z } from 'zod';
import { assistantSettingsSchema } from './assistants.ts';

export const ASSISTANT_RETENTION_DAYS = 365;

export const assistantRedactionWhySchema = z.enum(['retention', 'person']);
export const assistantUndoRefusalSchema = z.enum(['not_undoable', 'already_closed', 'hold_ended']);

export const customiseAssistantCommandSchema = z.strictObject({
  command: z.literal('customise_assistant'),
  requestId: z.uuid(),
  ...assistantSettingsSchema.shape,
  expectedVersion: z.number().int().min(0),
});

export const renewAssistCommandSchema = z.strictObject({
  command: z.literal('renew_assist'),
  requestId: z.uuid(),
  expiresAt: z.iso.datetime().nullable(),
});

export const revokeAssistCommandSchema = z.strictObject({
  command: z.literal('revoke_assist'),
  requestId: z.uuid(),
});

export const undoAssistantEffectCommandSchema = z.strictObject({
  command: z.literal('undo_assistant_effect'),
  requestId: z.uuid(),
  effectId: z.uuid(),
});

export const deleteMyAssistantHistoryCommandSchema = z.strictObject({
  command: z.literal('delete_my_assistant_history'),
  requestId: z.uuid(),
});

export type AssistantRedactionWhy = z.infer<typeof assistantRedactionWhySchema>;
export type AssistantUndoRefusal = z.infer<typeof assistantUndoRefusalSchema>;
export type CustomiseAssistantCommand = z.infer<typeof customiseAssistantCommandSchema>;
export type RenewAssistCommand = z.infer<typeof renewAssistCommandSchema>;
export type UndoAssistantEffectCommand = z.infer<typeof undoAssistantEffectCommandSchema>;
