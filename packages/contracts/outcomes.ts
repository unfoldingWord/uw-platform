import { z } from 'zod';

export const errorReasonSchema = z.enum([
  'risk_tier_undeclared',
  'reviewer_count_below_tier',
  'approver_lacks_domain_grant',
  'delegation_required',
  'command_not_wired',
  'malformed_command',
]);

export const acceptedOutcomeSchema = z.object({
  status: z.literal('accepted'),
  requestId: z.uuid(),
});

export const errorOutcomeSchema = z.object({
  status: z.literal('error'),
  requestId: z.uuid(),
  reason: errorReasonSchema,
});

export const outcomeSchema = z.discriminatedUnion('status', [
  acceptedOutcomeSchema,
  errorOutcomeSchema,
]);

export type ErrorReason = z.infer<typeof errorReasonSchema>;
export type AcceptedOutcome = z.infer<typeof acceptedOutcomeSchema>;
export type ErrorOutcome = z.infer<typeof errorOutcomeSchema>;
export type Outcome = z.infer<typeof outcomeSchema>;
