import { z } from 'zod';
import {
  capabilityWordSchema,
  connectorSchema,
  costBasisSchema,
  delegationLapseSchema,
  engineSchema,
  gateDecisionSchema,
  principalKindSchema,
  riskDomainsSchema,
  riskTierSchema,
  runFailureSchema,
  runHibernationSchema,
  runResultSchema,
  runShapeSchema,
  runStopSchema,
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
import { modelIdSchema, reviewRecordSchema, runStepCosts, runStepSchema } from './runs.ts';
import { fullShaSchema, riskDeclarationSchema, shipRefusalSchema } from './ship-rule.ts';
import { submitToGateResultSchema } from './verb-io.ts';

export const personaActivationRefusalSchema = z.enum([
  'unknown_verb',
  'forbidden_verb',
  'not_permitted',
  'engine_not_available',
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

const breakerEvidence = z.strictObject({
  spentMinor: z.number().int().min(0),
  capMinor: z.number().int().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  percent: z.number().int().min(0).max(100_000),
});
const hibernation = z.strictObject({ runId: id, why: runHibernationSchema });

const runEvidence = {
  run_started: z.strictObject({
    runId: id,
    persona: identitySchema,
    runShape: runShapeSchema,
    engine: engineSchema,
    model: modelIdSchema,
    delegationId: id.nullable(),
  }),
  run_step_recorded: z.strictObject({
    runId: id,
    step: runStepSchema,
    tokensIn: tokens,
    tokensOut: tokens,
    costBasis: costBasisSchema,
    leaseExpiresAt: instant,
    ...runStepCosts,
  }),
  run_hibernated: hibernation,
  run_resumed: hibernation,
  run_stopped: z.strictObject({ runId: id, why: runStopSchema }),
  run_failed: z.strictObject({
    runId: id,
    step: runStepSchema.nullable(),
    why: runFailureSchema,
    detail: z
      .string()
      .regex(/^[ -~]{1,500}$/)
      .nullable(),
  }),
  run_completed: z.strictObject({
    runId: id,
    result: runResultSchema,
    gates: z.array(stage).max(20),
    review: reviewRecordSchema.nullable(),
  }),
  run_prompted: z.strictObject({ runId: id, message: z.string().min(1).max(4000) }),
  premise_held: z.strictObject({ runId: id.nullable(), reason: oneLine }),
};

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
  item_reordered: z.strictObject({ priority: z.number().int(), before: id.nullable() }),
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
  stage_removed: z.strictObject({ stageId: id, key: stage, before: stageColumns }),
  harness_paused: z.strictObject({ stage: stage.nullable() }),
  harness_resumed: z.strictObject({ stage: stage.nullable() }),
  hosted_builder_set: z.strictObject({ enabled: z.boolean() }),
  breaker_holding: breakerEvidence,
  breaker_pausing: breakerEvidence,
  breaker_open: breakerEvidence,
  persona_activation_failed: z.strictObject({
    pageId: id,
    persona: personaIdentitySchema,
    verb: z
      .string()
      .regex(/^[a-z][a-z_]*$/)
      .nullable(),
    engine: engineSchema.nullable().default(null),
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

export const eventEvidenceSchemas = {
  ...itemEvidence,
  ...runEvidence,
  ...gateEvidence,
  ...harnessEvidence,
};

export type EvidenceName = keyof typeof eventEvidenceSchemas;
export type EventEvidence = {
  [Name in EvidenceName]: z.infer<(typeof eventEvidenceSchemas)[Name]>;
};
