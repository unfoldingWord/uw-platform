import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';
import { riskDomainsSchema, riskTierSchema } from './closed-sets.ts';
import { principalSchema } from './principal.ts';

export const ciJobSchema = z.enum([
  'security-audit',
  'lint',
  'typecheck',
  'architecture',
  'test',
  'build',
]);

export const checkConclusionSchema = z.enum([
  'success',
  'failure',
  'neutral',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
  'stale',
]);

export const shipRefusalSchema = z.enum([
  'pr_not_open',
  'pr_is_draft',
  'head_mismatch',
  'checks_not_green',
  'no_reviewer_approval',
  'risk_tier_undeclared',
  'reviewer_count_below_tier',
  'reviewer_providers_not_distinct',
  'approver_lacks_domain_grant',
]);

export const riskDeclarationSchema = z.strictObject({
  riskTier: riskTierSchema,
  riskDomains: riskDomainsSchema,
});

const sha = z.string().min(1).max(64);

export const shipRuleInputSchema = z.strictObject({
  pullRequest: z.strictObject({ open: z.boolean(), draft: z.boolean(), head: sha }).nullable(),
  expectedHead: sha.nullable(),
  checks: z.array(
    z.strictObject({
      name: z.string().min(1),
      headSha: sha,
      conclusion: checkConclusionSchema.nullable(),
    }),
  ),
  approvals: z.array(
    z.strictObject({
      reviewer: z.string().min(1),
      commit: sha,
      provider: z.string().min(1).nullable(),
    }),
  ),
  riskTier: riskTierSchema.nullable(),
  riskDomains: riskDomainsSchema,
  area: jdAreaSchema,
  approver: principalSchema,
  at: z.iso.datetime(),
  override: z.boolean(),
});

export const shipRuleOutcomeSchema = z.discriminatedUnion('verdict', [
  z.strictObject({ verdict: z.literal('advance') }),
  z.strictObject({ verdict: z.literal('refuse'), reasons: z.array(shipRefusalSchema).min(1) }),
]);

export type CiJob = z.infer<typeof ciJobSchema>;
export type ShipRefusal = z.infer<typeof shipRefusalSchema>;
export type RiskDeclaration = z.infer<typeof riskDeclarationSchema>;
export type ShipRuleInput = z.infer<typeof shipRuleInputSchema>;
export type ShipRuleOutcome = z.infer<typeof shipRuleOutcomeSchema>;
