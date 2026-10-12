import { z } from 'zod';
import {
  connectorSchema,
  gateStatusSchema,
  riskDomainsSchema,
  riskTierSchema,
} from './closed-sets.ts';
import { issueReferenceSchema, pullRequestDeclarationSchema } from './github.ts';
import { pullRequestRefSchema, stageKeySchema } from './harness.ts';
import {
  checkConclusionSchema,
  fullShaSchema,
  riskDeclarationSchema,
  shipRefusalSchema,
  shipRuleInputSchema,
} from './ship-rule.ts';

const sha = z.string().min(1).max(64);

const derivedSchema = z.strictObject({
  riskTier: riskTierSchema.nullable(),
  riskDomains: riskDomainsSchema,
  head: fullShaSchema.nullable(),
});

const recordedSchema = z.strictObject({
  riskTier: riskTierSchema.nullable(),
  riskDomains: riskDomainsSchema,
  floorDomains: riskDomainsSchema,
  head: fullShaSchema.nullable(),
  declaration: riskDeclarationSchema.nullable(),
  refusal: z.literal('risk_tier_undeclared').nullable(),
});

const factsSchema = z.strictObject({
  head: sha,
  state: z.enum(['open', 'closed', 'merged']),
  draft: z.boolean(),
  baseRef: z.string().min(1).max(255),
  freshAt: z.iso.datetime(),
  declaration: pullRequestDeclarationSchema
    .extend({ closes: z.array(issueReferenceSchema).max(50) })
    .nullable(),
});

const outcomeSchema = z.discriminatedUnion('verdict', [
  z.strictObject({ verdict: z.literal('advance') }),
  z.strictObject({
    verdict: z.literal('refuse'),
    reasons: z
      .array(shipRefusalSchema)
      .min(1)
      .max(shipRefusalSchema.options.length)
      .refine((reasons) => new Set(reasons).size === reasons.length, 'each refusal once'),
  }),
]);

const shipInputSchema = shipRuleInputSchema.omit({ approver: true }).extend({
  checks: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(255),
        headSha: sha,
        conclusion: checkConclusionSchema.nullable(),
      }),
    )
    .max(500),
  approvals: z
    .array(
      z.strictObject({
        reviewer: z.string().min(1).max(100),
        commit: sha,
        provider: z.string().min(1).max(100).nullable(),
      }),
    )
    .max(100),
});

const reviewSchema = z.strictObject({
  reviewer: z.string().min(1).max(100),
  commit: sha,
  state: z.enum(['approved', 'changes_requested', 'dismissed']),
  provider: z.string().min(1).max(100).nullable(),
  findings: z.array(z.string().min(1).max(500)).max(50),
});

export const gateViewSchema = z.strictObject({
  itemId: z.uuid(),
  harnessId: z.uuid(),
  stageKey: stageKeySchema,
  gateStatus: gateStatusSchema,
  connector: connectorSchema,
  expectedHead: fullShaSchema.nullable(),
  pullRequest: pullRequestRefSchema.nullable(),
  recorded: recordedSchema.nullable(),
  facts: factsSchema.nullable(),
  reviews: z.array(reviewSchema).max(100).default([]),
  ship: z
    .strictObject({
      input: shipInputSchema,
      outcome: outcomeSchema,
      derived: derivedSchema.nullable(),
    })
    .nullable(),
});

export type GateView = z.infer<typeof gateViewSchema>;
