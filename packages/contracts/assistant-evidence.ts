import { z } from 'zod';
import {
  assistantChannelSchema,
  assistantEffectFailureSchema,
  assistantEffectKindSchema,
  assistantPairingRefusalSchema,
  assistantPairingViaSchema,
  assistantSettingFieldSchema,
  assistantTurnOutcomeSchema,
  assistantTurnRefusalSchema,
} from './assistants.ts';
import {
  assistantJdIdSchema,
  assistantProvisioningFailureSchema,
  assistantProvisioningStepSchema,
} from './assistant-accounts.ts';
import { ASSISTANT_BUDGET_MOST_MINOR } from './assistant-commands.ts';
import { assistantRedactionWhySchema } from './assistant-history.ts';
import { assistantMailRefusalSchema } from './assistant-mail.ts';
import {
  assistantProposalDecisionSchema,
  assistantProposalKindSchema,
} from './assistant-proposals.ts';
import { assistantResearchKindSchema } from './assistant-research.ts';
import { verbNameSchema } from './verb-names.ts';

const id = z.uuid();
const count = z.number().int().min(0);

export const assistantEvidence = {
  assistant_customised: z.strictObject({
    fields: z.array(assistantSettingFieldSchema).min(1).max(3),
  }),
  assistant_request_recorded: z.strictObject({
    requestId: id,
    channel: assistantChannelSchema,
  }),
  assistant_turn_started: z.strictObject({
    requestId: id,
    turnId: id,
    attemptId: id,
    delegationId: id,
    personaVersion: z.number().int().min(1),
  }),
  assistant_turn_refused: z.strictObject({
    requestId: id,
    why: assistantTurnRefusalSchema,
  }),
  assistant_turn_finished: z.strictObject({
    requestId: id,
    turnId: id,
    outcome: assistantTurnOutcomeSchema,
    turns: count,
    inputTokens: count,
    outputTokens: count,
    costMicros: count.nullable(),
    tools: z.array(verbNameSchema).max(100),
  }),
  assistant_effect_started: z.strictObject({
    effectId: id,
    requestId: id,
    kind: assistantEffectKindSchema,
  }),
  assistant_effect_done: z.strictObject({
    effectId: id,
    kind: assistantEffectKindSchema,
  }),
  assistant_effect_failed: z.strictObject({
    effectId: id,
    kind: assistantEffectKindSchema,
    why: assistantEffectFailureSchema,
  }),
  assistant_reminder_set: z.strictObject({ reminderId: id, effectId: id }),
  assistant_reminder_cancelled: z.strictObject({ reminderId: id, effectId: id }),
  assistant_reminder_fired: z.strictObject({ reminderId: id }),
  assistant_reminder_undelivered: z.strictObject({
    reminderId: id,
    why: assistantEffectFailureSchema,
  }),
  assistant_hold_placed: z.strictObject({ holdId: id, effectId: id }),
  assistant_hold_released: z.strictObject({ holdId: id, effectId: id }),
  assistant_budget_set: z.strictObject({
    monthlyMinor: z.number().int().min(0).max(ASSISTANT_BUDGET_MOST_MINOR).nullable(),
  }),
  assistant_pairing_started: z.strictObject({ channel: assistantChannelSchema }),
  assistant_paired: z.strictObject({
    channel: assistantChannelSchema,
    via: assistantPairingViaSchema,
  }),
  assistant_pairing_refused: z.strictObject({
    channel: assistantChannelSchema,
    why: assistantPairingRefusalSchema,
  }),
  assistant_enabled: z.strictObject({ jdId: assistantJdIdSchema, restored: z.boolean() }),
  assistant_disabled: z.strictObject({ revoked: count }),
  assistant_provisioned: z.strictObject({ goal: z.enum(['enabled', 'disabled']) }),
  assistant_provisioning_failed: z.strictObject({
    step: assistantProvisioningStepSchema,
    why: assistantProvisioningFailureSchema,
  }),
  assistant_deleted: z.strictObject({ jdId: assistantJdIdSchema }),
  assistant_effect_undone: z.strictObject({ effectId: id, kind: assistantEffectKindSchema }),
  assistant_history_redacted: z.strictObject({
    why: assistantRedactionWhySchema,
    requests: count,
  }),
  assistant_mail_declined: z.strictObject({ why: assistantMailRefusalSchema }),
  assistant_proposal_drafted: z.strictObject({
    proposalId: id,
    requestId: id,
    kind: assistantProposalKindSchema,
  }),
  assistant_proposal_decided: z.strictObject({
    proposalId: id,
    kind: assistantProposalKindSchema,
    decision: assistantProposalDecisionSchema,
  }),
  assistant_proposal_expired: z.strictObject({ proposalId: id }),
  assistant_research_used: z.strictObject({
    requestId: id,
    turnId: id,
    kind: assistantResearchKindSchema,
  }),
};
