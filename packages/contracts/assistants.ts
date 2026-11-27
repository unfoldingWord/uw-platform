import { z } from 'zod';
import { untrustedSourceSchema } from './closed-sets.ts';

export const ASSISTANT_TEMPLATE_KEY = 'assistant';

const ASSISTANT_PREFIX = 'assistant-';
const ASSISTANT_IDENTITY_PREFIX = `agent:${ASSISTANT_PREFIX}`;
const UNTRUSTED_TOTAL_LIMIT = 100_000;

export function templateStageCountFits(template: string, stageCount: number): boolean {
  return (template === ASSISTANT_TEMPLATE_KEY) === (stageCount === 0);
}

export function assistantHarnessKey(personId: string): string {
  return `${ASSISTANT_PREFIX}${personId}`;
}

export function assistantIdentityOf(personId: string): string {
  return `${ASSISTANT_IDENTITY_PREFIX}${personId}`;
}

export function assistantPersonOf(identity: string): string | null {
  if (!identity.startsWith(ASSISTANT_IDENTITY_PREFIX)) return null;
  const personId = identity.slice(ASSISTANT_IDENTITY_PREFIX.length);
  return z.uuid().safeParse(personId).success ? personId : null;
}

export const assistantChannelSchema = z.enum(['zulip_dm', 'email']);
export const assistantDirectEffectSchema = z.enum([
  'reply_to_requester',
  'reminder_set',
  'reminder_cancelled',
  'calendar_hold_added',
  'calendar_hold_changed',
  'calendar_hold_removed',
]);
export const assistantEffectKindSchema = z.enum([...assistantDirectEffectSchema.options]);
export const assistantTurnRefusalSchema = z.enum([
  'delegation_required',
  'persona_inactive',
  'spend_held',
  'assistant_budget_spent',
  'turn_taken',
  'harness_paused',
  'assistants_capped',
]);
export const assistantTurnOutcomeSchema = z.enum([
  'ended',
  'turn_limit',
  'refused',
  'failed',
  'abandoned',
]);
export const assistantEffectFailureSchema = z.enum([
  'not_paired',
  'dropped',
  'not_wired',
  'outcome_unknown',
  'delegation_lapsed',
  'deadline_passed',
  'reminder_closed',
  'calendar_refused',
  'calendar_unavailable',
  'not_own_hold',
]);
export const assistantReminderStatusSchema = z.enum(['set', 'fired', 'cancelled', 'undelivered']);
export const assistantReminderRefusalSchema = z.enum([
  'due_in_past',
  'due_too_far',
  'effects_capped',
  'reminders_capped',
  'reminder_not_found',
]);
export const assistantHoldStatusSchema = z.enum(['held', 'released']);
export const assistantCalendarRefusalSchema = z.enum([
  'outside_organization',
  'hold_in_past',
  'hold_too_long',
  'hold_too_far',
  'holds_capped',
  'hold_not_found',
  'calendar_refused',
  'calendar_unavailable',
  'calendar_not_wired',
]);
export const assistantPairingViaSchema = z.enum(['email_match', 'pairing_code']);
export const assistantPairingRefusalSchema = z.enum([
  'no_pairing',
  'pairing_code_wrong',
  'pairing_code_expired',
  'pairing_attempts_spent',
  'address_taken',
]);
export const assistantSettingFieldSchema = z.enum(['display_name', 'instructions', 'timezone']);

export const untrustedPartSchema = z.strictObject({
  source: untrustedSourceSchema,
  text: z.string().min(1).max(50_000),
});

export const assistantRequestInputSchema = z
  .strictObject({
    personId: z.uuid(),
    channel: assistantChannelSchema,
    externalId: z.string().min(1).max(200),
    threadKey: z.string().min(1).max(200).nullable(),
    replyAddress: z.string().min(1).max(254),
    receivedAt: z.iso.datetime(),
    note: z.string().max(20_000),
    untrustedParts: z.array(untrustedPartSchema).max(20),
  })
  .refine(
    (input) =>
      input.untrustedParts.reduce((total, part) => total + part.text.length, 0) <=
      UNTRUSTED_TOTAL_LIMIT,
    'the untrusted parts total at most 100,000 characters',
  );

export const assistantSettingsSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(60),
  instructionsMd: z.string().max(8_000),
  timezone: z.string().min(1).max(64),
});

export type AssistantChannel = z.infer<typeof assistantChannelSchema>;
export type AssistantDirectEffect = z.infer<typeof assistantDirectEffectSchema>;
export type AssistantEffectKind = z.infer<typeof assistantEffectKindSchema>;
export type AssistantTurnRefusal = z.infer<typeof assistantTurnRefusalSchema>;
export type AssistantTurnOutcome = z.infer<typeof assistantTurnOutcomeSchema>;
export type AssistantEffectFailure = z.infer<typeof assistantEffectFailureSchema>;
export type AssistantReminderStatus = z.infer<typeof assistantReminderStatusSchema>;
export type AssistantReminderRefusal = z.infer<typeof assistantReminderRefusalSchema>;
export type AssistantHoldStatus = z.infer<typeof assistantHoldStatusSchema>;
export type AssistantCalendarRefusal = z.infer<typeof assistantCalendarRefusalSchema>;
export type AssistantPairingVia = z.infer<typeof assistantPairingViaSchema>;
export type AssistantPairingRefusal = z.infer<typeof assistantPairingRefusalSchema>;
export type AssistantSettingField = z.infer<typeof assistantSettingFieldSchema>;
export type UntrustedPart = z.infer<typeof untrustedPartSchema>;
export type AssistantRequestInput = z.infer<typeof assistantRequestInputSchema>;
export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;
