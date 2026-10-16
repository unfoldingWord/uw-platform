import { z } from 'zod';
import {
  capabilityWordSchema,
  connectorSchema,
  costBasisSchema,
  delegableTierSchema,
  delegationLapseSchema,
  engineSchema,
  findingWeightSchema,
  intakeViaSchema,
  gateDecisionSchema,
  principalKindSchema,
  reviewVerdictSchema,
  riskDomainsSchema,
  riskTierSchema,
  runFailureSchema,
  runHibernationSchema,
  runResultSchema,
  runShapeSchema,
  runStopSchema,
} from './closed-sets.ts';
import {
  epicPlaceSchema,
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
import { dataSourceKindSchema } from './page-types.ts';
import {
  modelIdSchema,
  providerIdSchema,
  reviewFindingSchema,
  reviewRecordSchema,
  runStepCosts,
  runStepSchema,
} from './runs.ts';
import { shadowVerdictValueSchema } from './shadow.ts';
import { fullShaSchema, riskDeclarationSchema, shipRefusalSchema } from './ship-rule.ts';
import { submitToGateResultSchema } from './verb-io.ts';
import { pullRequestDeclarationSchema } from './github.ts';
import { ZULIP_TEXT_LIMIT, zulipTopicSchema } from './zulip.ts';

export const personaActivationRefusalSchema = z.enum([
  'unknown_verb',
  'forbidden_verb',
  'not_permitted',
  'engine_not_available',
  'dry_run_failed',
]);
export const learningAttachedKindSchema = z.enum(['learning', 'revision']);
export const handOffReasonSchema = z.enum(['review_rounds_exhausted', 'engine_refused']);

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

export const delegatedMergeSchema = z.strictObject({
  decisionId: id,
  delegationId: id,
  personId: id,
  email: z.email(),
  persona: personaIdentitySchema,
  expiresAt: instant,
  maxTier: delegableTierSchema,
});
export type DelegatedMerge = z.infer<typeof delegatedMergeSchema>;

const itemEvidence = {
  item_created: z
    .strictObject({
      stage,
      title: z.string().min(1).max(200),
      pageId: id.nullable(),
      priority: z.number().int(),
      due: z.iso.date().nullable(),
      issue: issueRefSchema.nullable().default(null),
      pullRequest: pullRequestRefSchema.nullable().default(null),
      expectedHead: head.nullable().default(null),
      epic: epicPlaceSchema.nullable().default(null),
      blockedBy: z.array(id).max(50).default([]),
    })
    .refine(
      (created) => (created.pullRequest === null) === (created.expectedHead === null),
      'a joined pull request comes with its head',
    ),
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
  learning_attached: z.strictObject({
    pageId: id,
    kind: learningAttachedKindSchema.default('learning'),
  }),
  nothing_learned: z.strictObject({ reason: oneLine }),
  zulip_topic_linked: z.strictObject({ topic: zulipTopicSchema }),
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
  delegated_merge: delegatedMergeSchema,
  delegated_exit_claimed: z.strictObject({ decisionId: id }),
  fix_claimed: z.strictObject({
    delegationId: id,
    head,
    declaration: pullRequestDeclarationSchema.nullable(),
  }),
  review_verdict_recorded: z.strictObject({
    runId: id,
    head,
    reviewer: z.string().regex(/^[a-z0-9-]{1,64}$/),
    provider: providerIdSchema,
    model: modelIdSchema,
    verdict: reviewVerdictSchema,
    findings: z.array(reviewFindingSchema).max(50),
  }),
  finding_refuted: z.strictObject({
    runId: id,
    persona: identitySchema,
    reviewer: z.string().regex(/^[a-z0-9-]{1,64}$/),
    index: z.number().int().min(0).max(49),
    weight: findingWeightSchema,
    text,
  }),
  shadow_verdict: z.strictObject({
    head: head.nullable(),
    verdict: shadowVerdictValueSchema,
    reasons: z.array(shipRefusalSchema).max(shipRefusalSchema.options.length),
  }),
};

const harnessEvidence = {
  freeze_changed: z.strictObject({ frozen: z.boolean(), allow: z.array(id).max(100) }),
  delegation_granted: z.strictObject({
    delegationId: id,
    personId: id,
    persona: personaIdentitySchema,
    capability: capabilityWordSchema,
    expiresAt: instant,
    supersedes: id.nullable(),
    maxTier: delegableTierSchema.nullable().default(null),
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
  fix_claim_set: z.strictObject({ enabled: z.boolean() }),
  comment_recorded: z.strictObject({
    source: z.literal('zulip'),
    messageId: z.number().int().min(1),
    topic: zulipTopicSchema,
    personId: id.nullable(),
    email: z.string().min(3).max(254),
    text: z.string().max(ZULIP_TEXT_LIMIT),
    truncated: z.boolean(),
  }),
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
  persona_activated: z.strictObject({
    pageId: id,
    persona: personaIdentitySchema,
    version: z.number().int().min(1),
  }),
  measurement_recorded: z.strictObject({
    measurementId: id,
    source: dataSourceKindSchema,
    name: z.string().min(1).max(100),
    value: z.number().finite(),
    asOf: z.iso.date(),
  }),
  handed_to_person: z
    .strictObject({
      personId: id,
      why: handOffReasonSchema,
      rounds: z.number().int().min(1).nullable(),
    })
    .refine(
      (handed) => (handed.why === 'review_rounds_exhausted') === (handed.rounds !== null),
      'only review rounds name a round count',
    ),
  template_activated: z.strictObject({
    template: slugSchema,
    stages: z.array(stage).min(1),
    repository: repositorySchema.nullable(),
    shadow: z.boolean().default(false),
  }),
  shadow_lifted: z.strictObject({}),
  epic_enqueued: z.strictObject({
    epic: issueRefSchema,
    title: z.string().min(1).max(200),
    items: z
      .array(
        z.strictObject({
          itemId: id,
          issue: issueRefSchema,
          created: z.boolean(),
          blockedBy: z.array(id).max(50),
        }),
      )
      .min(1)
      .max(100),
    outside: z.array(z.number().int().min(1)).max(50),
    doneWhen: z.array(text).max(100),
  }),
  done_when_missing: z
    .strictObject({
      via: intakeViaSchema,
      issue: issueRefSchema.nullable(),
      pageId: id.nullable(),
      title: z.string().min(1).max(200),
    })
    .refine(
      (missing) => (missing.issue === null) !== (missing.pageId === null),
      'an issue or a page',
    ),
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
