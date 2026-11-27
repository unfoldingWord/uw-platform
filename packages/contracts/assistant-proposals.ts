import { z } from 'zod';
import type { AssistantProposedEffect } from './assistants.ts';

export const ASSISTANT_PROPOSAL_DAYS = 7;

export const assistantProposalKindSchema = z.enum(['email', 'invite', 'page_append']);
export const assistantProposalStatusSchema = z.enum(['pending', 'accepted', 'declined', 'expired']);
export const assistantProposalDecisionSchema = z.enum(['accept', 'decline']);
export const assistantProposalRefusalSchema = z.enum([
  'proposals_capped',
  'page_not_found',
  'page_not_editable',
  'invite_in_past',
  'invite_too_long',
  'invite_too_far',
  'proposal_not_found',
  'already_decided',
  'proposal_expired',
  'proposal_changed',
]);
const proposalDigestSchema = z.string().regex(/^[0-9a-f]{64}$/);

const instant = z.iso.datetime({ offset: true });
const addresses = (least: number, most: number) => z.array(z.email()).min(least).max(most);

const emailProposalSchema = z.strictObject({
  to: addresses(1, 10),
  cc: addresses(0, 10).optional(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
});

const inviteProposalSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  start: instant,
  end: instant,
  attendees: addresses(1, 20),
  description: z.string().max(4_000).optional(),
});

const pageAppendProposalSchema = z.strictObject({
  pageId: z.uuid(),
  heading: z.string().trim().min(1).max(200).optional(),
  text: z.string().trim().min(1).max(50_000),
});

export const assistantProposalPayloadSchemas = {
  email: emailProposalSchema,
  invite: inviteProposalSchema,
  page_append: pageAppendProposalSchema,
} as const;

export function proposedEffectOf(kind: AssistantProposalKind): AssistantProposedEffect {
  if (kind === 'email') return 'email_sent';
  return kind === 'invite' ? 'invite_sent' : 'page_appended';
}

export function proposalPayloadSchemaOf(kind: AssistantProposalKind) {
  if (kind === 'email') return emailProposalSchema;
  return kind === 'invite' ? inviteProposalSchema : pageAppendProposalSchema;
}

export const decideAssistantProposalCommandSchema = z.strictObject({
  command: z.literal('decide_assistant_proposal'),
  requestId: z.uuid(),
  proposalId: z.uuid(),
  decision: assistantProposalDecisionSchema,
  digest: proposalDigestSchema,
});

export type AssistantProposalKind = z.infer<typeof assistantProposalKindSchema>;
export type AssistantProposalStatus = z.infer<typeof assistantProposalStatusSchema>;
export type AssistantProposalDecision = z.infer<typeof assistantProposalDecisionSchema>;
export type AssistantProposalRefusal = z.infer<typeof assistantProposalRefusalSchema>;
export type EmailProposal = z.infer<typeof emailProposalSchema>;
export type InviteProposal = z.infer<typeof inviteProposalSchema>;
export type PageAppendProposal = z.infer<typeof pageAppendProposalSchema>;
export type DecideAssistantProposalCommand = z.infer<typeof decideAssistantProposalCommandSchema>;
