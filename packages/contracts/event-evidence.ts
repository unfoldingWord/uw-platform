import { z } from 'zod';
import {
  capabilityWordSchema,
  connectorSchema,
  costBasisSchema,
  delegationLapseSchema,
  gateDecisionSchema,
  principalKindSchema,
  riskDomainsSchema,
  riskTierSchema,
} from './closed-sets.ts';
import {
  issueRefSchema,
  personaIdentitySchema,
  pullRequestRefSchema,
  repositorySchema,
  stageKeySchema,
  stageSchema,
} from './harness.ts';
import { identitySchema } from './identity.ts';
import { errorReasonSchema } from './outcomes.ts';
import { slugSchema } from './pages.ts';
import { fullShaSchema, riskDeclarationSchema, shipRefusalSchema } from './ship-rule.ts';
import { runStepSchema, submitToGateResultSchema } from './verb-io.ts';

export const personaActivationRefusalSchema = z.enum([
  'unknown_verb',
  'forbidden_verb',
  'not_permitted',
]);

const id = z.uuid();
const instant = z.iso.datetime();
const stage = stageKeySchema;
const text = z.string().min(1).max(500);
const head = fullShaSchema;
const decidedBase = z.strictObject({ sha: fullShaSchema, ref: z.string().min(1).max(255) });
const effect = connectorSchema.exclude(['none']);
const stageColumnSchema = z.strictObject(
  stageSchema.omit({ id: true, harnessId: true }).partial().shape,
);
const stageColumns = z.record(z.string(), z.json()).superRefine((columns, context) => {
  const result = stageColumnSchema.safeParse(columns);
  if (result.success) return;
  for (const issue of result.error.issues) {
    context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  }
});
const tokens = z.number().int().min(0);
const nonBlank = z
  .string()
  .max(2000)
  .refine((value) => value.trim().length > 0, 'a reason is not blank');
const oneLine = z
  .string()
  .max(200)
  .refine((value) => value.trim().length > 0 && !/[\r\n]/.test(value), 'one line of reason');

const itemEvidence = {
  item_created: z.strictObject({
    stage,
    title: z.string().min(1).max(200),
    pageId: id.nullable(),
    priority: z.number().int(),
    due: z.iso.date().nullable(),
    issue: issueRefSchema.nullable().default(null),
  }),
  item_claimed: z.strictObject({
    holder: identitySchema,
    claimantKind: principalKindSchema,
    delegationId: id.nullable(),
    leaseExpiresAt: instant.nullable(),
  }),
  item_released: z.strictObject({ holder: identitySchema }),
  lease_renewed: z.strictObject({ leaseExpiresAt: instant }),
  lease_expired: z.strictObject({ holder: identitySchema, leaseExpiresAt: instant }),
  branch_abandoned: z.strictObject({ head: head.nullable() }),
  branch_adopted: z.strictObject({ head: head.nullable() }),
  stage_advanced: z.strictObject({ from: stage, to: stage.nullable() }),
  loop_edge_taken: z.strictObject({ from: stage, to: stage }),
  label_removed: z.strictObject({
    issue: issueRefSchema,
    label: z.string().min(1).max(50),
    githubUpdatedAt: instant,
  }),
  risk_derived: z.strictObject({
    paths: z.array(z.string().min(1)),
    declaration: riskDeclarationSchema.nullable(),
    floorDomains: riskDomainsSchema,
    riskTier: riskTierSchema.nullable(),
    riskDomains: riskDomainsSchema,
    refusal: z.literal('risk_tier_undeclared').nullable(),
    head: head.nullable().default(null),
    repository: repositorySchema.nullable().default(null),
    base: decidedBase.nullable().default(null),
  }),
  run_step_recorded: z.strictObject({
    runId: id,
    step: runStepSchema,
    tokensIn: tokens,
    tokensOut: tokens,
    costBasis: costBasisSchema,
    leaseExpiresAt: instant,
  }),
  learning_attached: z.strictObject({ pageId: id }),
  nothing_learned: z.strictObject({ reason: oneLine }),
};

const gateEvidence = {
  submitted_to_gate: z.strictObject({
    stage,
    result: submitToGateResultSchema,
    to: stage.nullable(),
    expectedHead: head.nullable(),
    pullRequest: pullRequestRefSchema.nullable(),
    evidence: z.record(z.string(), z.json()),
  }),
  checks_passed: z.strictObject({ stage, validators: z.array(z.string().min(1)) }),
  checks_failed: z.strictObject({ stage, failures: z.array(text).min(1) }),
  gate_approved: z.strictObject({ decisionId: id, stage }),
  gate_rejected: z.strictObject({ decisionId: id, stage, findings: z.array(text) }),
  gate_taken_over: z.strictObject({ decisionId: id, stage, holder: identitySchema }),
  gate_overridden: z.strictObject({ decisionId: id, stage, reason: nonBlank }),
  gate_refused_to_agent: z.strictObject({ decision: gateDecisionSchema, stage }),
  ship_refused: z.strictObject({ stage, reasons: z.array(shipRefusalSchema).min(1) }),
  connector_succeeded: z.strictObject({
    connector: effect,
    detail: z.record(z.string(), z.string()),
  }),
  connector_refused: z.strictObject({ connector: effect, reason: text }),
};

const harnessEvidence = {
  delegation_granted: z.strictObject({
    delegationId: id,
    personId: id,
    persona: personaIdentitySchema,
    capability: capabilityWordSchema,
    expiresAt: instant,
    supersedes: id.nullable(),
  }),
  delegation_revoked: z.strictObject({ delegationId: id }),
  delegation_lapsed: z.strictObject({ delegationId: id, why: delegationLapseSchema }),
  delegation_required: z.strictObject({ stage }),
  stage_edit_refused: z.strictObject({
    stage: stage.nullable(),
    reason: errorReasonSchema,
    code: z.string().nullable(),
    constraint: z.string().nullable(),
  }),
  stage_edited: z.strictObject({
    stageId: id,
    key: stage,
    before: stageColumns.nullable(),
    after: stageColumns,
  }),
  persona_activation_failed: z.strictObject({
    pageId: id,
    persona: personaIdentitySchema,
    verb: z.string().regex(/^[a-z][a-z_]*$/),
    reason: personaActivationRefusalSchema,
    message: text,
    itemId: id.nullable(),
  }),
  template_activated: z.strictObject({
    template: slugSchema,
    stages: z.array(stage).min(1),
    repository: repositorySchema.nullable(),
  }),
};

export const eventEvidenceSchemas = { ...itemEvidence, ...gateEvidence, ...harnessEvidence };

export type EvidenceName = keyof typeof eventEvidenceSchemas;
export type EventEvidence = {
  [Name in EvidenceName]: z.infer<(typeof eventEvidenceSchemas)[Name]>;
};
