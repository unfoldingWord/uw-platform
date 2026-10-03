import { z } from 'zod';
import {
  connectorSchema,
  gateStatusSchema,
  riskDomainsSchema,
  riskTierSchema,
} from './closed-sets.ts';
import { pullRequestDeclarationSchema } from './github.ts';
import { pullRequestRefSchema, stageKeySchema } from './harness.ts';
import {
  checkConclusionSchema,
  fullShaSchema,
  riskDeclarationSchema,
  shipRuleInputSchema,
  shipRuleOutcomeSchema,
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
  declaration: pullRequestDeclarationSchema.nullable(),
});

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
  ship: z
    .strictObject({
      input: shipInputSchema,
      outcome: shipRuleOutcomeSchema,
      derived: derivedSchema.nullable(),
    })
    .nullable(),
});

export type GateView = z.infer<typeof gateViewSchema>;
