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
  'base_behind',
  'auto_close_keyword',
  'skip_ci_marker',
  'required_check_never_ran',
  'harness_frozen',
]);

export const riskDeclarationSchema = z.strictObject({
  riskTier: riskTierSchema,
  riskDomains: riskDomainsSchema,
});

const sha = z.string().min(1).max(64);

export const fullShaPattern = '^(?:[0-9a-f]{40}|[0-9a-f]{64})$';
export const fullShaSchema = z
  .string()
  .regex(new RegExp(fullShaPattern), 'a head is a full lowercase commit SHA');

export const requiredCheckSchema = z.strictObject({
  app: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  name: z.string().min(1).max(200),
});

const distinctChecks = (checks: readonly { readonly app: string; readonly name: string }[]) =>
  new Set(checks.map((check) => `${check.app} ${check.name}`)).size === checks.length;

export const requiredChecksSchema = z
  .array(requiredCheckSchema)
  .max(30)
  .refine(distinctChecks, 'each required check once');

export const defaultCiChecks: readonly z.infer<typeof requiredCheckSchema>[] =
  ciJobSchema.options.map((name) => ({ app: 'github-actions', name }));

export const closingRefSchema = z.strictObject({
  repo: z.string().regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/),
  number: z.number().int().min(1),
});

export const shipRuleInputSchema = z.strictObject({
  pullRequest: z
    .strictObject({
      open: z.boolean(),
      draft: z.boolean(),
      head: sha,
      behindBy: z.number().int().min(0).nullable(),
      skipCi: z.boolean().nullable(),
    })
    .nullable(),
  expectedHead: sha.nullable(),
  carries: z.array(sha).max(250),
  checks: z.array(
    z.strictObject({
      name: z.string().min(1),
      app: z.string().min(1).nullable(),
      headSha: sha,
      conclusion: checkConclusionSchema.nullable(),
    }),
  ),
  requiredChecks: requiredChecksSchema,
  approvals: z.array(
    z.strictObject({
      reviewer: z.string().min(1),
      commit: sha,
      provider: z.string().min(1).nullable(),
    }),
  ),
  closes: z.array(closingRefSchema).max(100),
  wraps: closingRefSchema.nullable(),
  riskTier: riskTierSchema.nullable(),
  riskDomains: riskDomainsSchema,
  area: jdAreaSchema,
  approver: principalSchema,
  at: z.iso.datetime(),
  frozen: z.boolean(),
  override: z.boolean(),
});

export const shipRuleOutcomeSchema = z.discriminatedUnion('verdict', [
  z.strictObject({ verdict: z.literal('advance') }),
  z.strictObject({ verdict: z.literal('refuse'), reasons: z.array(shipRefusalSchema).min(1) }),
]);

export type CiJob = z.infer<typeof ciJobSchema>;
export type RequiredCheck = z.infer<typeof requiredCheckSchema>;
export type ClosingRef = z.infer<typeof closingRefSchema>;
export type ShipRefusal = z.infer<typeof shipRefusalSchema>;
export type RiskDeclaration = z.infer<typeof riskDeclarationSchema>;
export type ShipRuleInput = z.infer<typeof shipRuleInputSchema>;
export type ShipRuleOutcome = z.infer<typeof shipRuleOutcomeSchema>;
