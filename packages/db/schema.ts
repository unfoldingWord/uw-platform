import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  agentPickupSchema,
  branchStateSchema,
  capabilityWordSchema,
  connectorSchema,
  costBasisSchema,
  dataSourceKindSchema,
  engineSchema,
  eventNameSchema,
  exitGateSchema,
  gateDecisionSchema,
  gateStatusSchema,
  principalKindSchema,
  riskDomainSchema,
  riskTierSchema,
  runOutcomeSchema,
  runShapeSchema,
  stageBracketSchema,
} from '@uw/contracts';
import {
  HUMAN_IDENTITY_PATTERN,
  IDENTITY_PATTERN,
  JD_AREA_PATTERN,
  PERSONA_IDENTITY_PATTERN,
  REPOSITORY_PATTERN,
  SLUG_PATTERN,
  STAGE_KEY_PATTERN,
  matches,
  oneOf,
  subsetOf,
} from './checks.ts';
import { instant } from './columns.ts';
import { declareTable } from './declarations.ts';
import { pages, people } from './schema-platform.ts';

export * from './schema-platform.ts';
export * from './schema-github.ts';

const internalSync = { classification: 'internal', offlineEligibility: 'sync' } as const;
const restrictedNever = { classification: 'restricted', offlineEligibility: 'never' } as const;
const emptyText = sql`'{}'::text[]`;

export const harnesses = declareTable(
  'harnesses',
  {
    id: uuid('id').primaryKey(),
    key: text('key').notNull().unique(),
    template: text('template').notNull(),
    jdArea: text('jd_area').notNull(),
    hostedBuilderEnabled: boolean('hosted_builder_enabled').notNull().default(false),
    paused: boolean('paused').notNull().default(false),
    createdAt: instant('created_at').notNull(),
    repository: text('repository'),
  },
  internalSync,
  (t) => [
    check('harnesses_area_form', matches(t.jdArea, JD_AREA_PATTERN)),
    check('harnesses_key_form', matches(t.key, SLUG_PATTERN)),
    check('harnesses_template_form', matches(t.template, SLUG_PATTERN)),
    check('harnesses_repository_form', matches(t.repository, REPOSITORY_PATTERN)),
    uniqueIndex('harnesses_repository_once')
      .on(sql`lower(${t.repository})`)
      .where(sql`${t.repository} IS NOT NULL`),
  ],
);

export const harnessStages = declareTable(
  'harness_stages',
  {
    id: uuid('id').primaryKey(),
    harnessId: uuid('harness_id')
      .notNull()
      .references(() => harnesses.id),
    key: text('key').notNull(),
    title: text('title').notNull(),
    position: integer('position').notNull(),
    bracket: text('bracket').notNull(),
    agentPickup: text('agent_pickup').notNull(),
    exitGate: text('exit_gate').notNull(),
    connector: text('connector').notNull().default('none'),
    wipLimit: integer('wip_limit').notNull().default(3),
    instructionsPageId: uuid('instructions_page_id').references(() => pages.id),
    validators: text('validators').array().notNull().default(emptyText),
    feeds: text('feeds').array().notNull().default(emptyText),
    paused: boolean('paused').notNull().default(false),
  },
  internalSync,
  (t) => [
    check(
      'harness_stages_effect_needs_human_gate',
      sql`${t.connector} = 'none' OR ${t.exitGate} = 'human_approval'`,
    ),
    check('harness_stages_connector_known', oneOf(t.connector, connectorSchema.options)),
    check('harness_stages_exit_gate_known', oneOf(t.exitGate, exitGateSchema.options)),
    check('harness_stages_agent_pickup_known', oneOf(t.agentPickup, agentPickupSchema.options)),
    check('harness_stages_bracket_known', oneOf(t.bracket, stageBracketSchema.options)),
    check('harness_stages_key_form', matches(t.key, STAGE_KEY_PATTERN)),
    check('harness_stages_position_positive', sql`${t.position} > 0`),
    check('harness_stages_wip_limit_positive', sql`${t.wipLimit} >= 1`),
    uniqueIndex('harness_stages_key_per_harness').on(t.harnessId, t.key),
    uniqueIndex('harness_stages_position_per_harness').on(t.harnessId, t.position),
    unique('harness_stages_harness_and_id').on(t.harnessId, t.id),
  ],
);

export const delegations = declareTable(
  'delegations',
  {
    id: uuid('id').primaryKey(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    persona: text('persona').notNull(),
    harnessId: uuid('harness_id')
      .notNull()
      .references(() => harnesses.id),
    capability: text('capability').notNull(),
    grantedAt: instant('granted_at').notNull(),
    expiresAt: instant('expires_at').notNull(),
    revokedAt: instant('revoked_at'),
    lapsedAt: instant('lapsed_at'),
    supersedes: uuid('supersedes'),
    traceId: uuid('trace_id').notNull(),
  },
  restrictedNever,
  (t) => [
    foreignKey({
      name: 'delegations_supersedes_fk',
      columns: [t.supersedes],
      foreignColumns: [t.id],
    }),
    check('delegations_capability_known', oneOf(t.capability, capabilityWordSchema.options)),
    check('delegations_persona_form', matches(t.persona, PERSONA_IDENTITY_PATTERN)),
    check('delegations_expires_after_grant', sql`${t.expiresAt} > ${t.grantedAt}`),
    index('delegations_person').on(t.personId),
    index('delegations_harness').on(t.harnessId),
    uniqueIndex('delegations_supersedes_once')
      .on(t.supersedes)
      .where(sql`${t.supersedes} IS NOT NULL`),
  ],
);

export const harnessItems = declareTable(
  'harness_items',
  {
    id: uuid('id').primaryKey(),
    harnessId: uuid('harness_id')
      .notNull()
      .references(() => harnesses.id),
    stageId: uuid('stage_id').notNull(),
    title: text('title').notNull(),
    pageId: uuid('page_id').references(() => pages.id),
    priority: integer('priority').notNull().default(0),
    due: date('due', { mode: 'string' }),
    claimedBy: text('claimed_by'),
    claimantKind: text('claimant_kind'),
    delegationId: uuid('delegation_id').references(() => delegations.id),
    leaseExpires: instant('lease_expires'),
    gateStatus: text('gate_status').notNull().default('working'),
    gateTarget: text('gate_target'),
    riskTier: text('risk_tier'),
    riskDomains: text('risk_domains').array().notNull().default(emptyText),
    expectedHead: text('expected_head'),
    branchState: text('branch_state').notNull().default('none'),
    prRepo: text('pr_repo'),
    prNumber: integer('pr_number'),
    issueRepo: text('issue_repo'),
    issueNumber: integer('issue_number'),
    issueGithubId: bigint('issue_github_id', { mode: 'number' }),
    zulipTopic: text('zulip_topic'),
    createdAt: instant('created_at').notNull(),
  },
  internalSync,
  (t) => [
    foreignKey({
      name: 'harness_items_stage_fk',
      columns: [t.harnessId, t.stageId],
      foreignColumns: [harnessStages.harnessId, harnessStages.id],
    }),
    unique('harness_items_harness_and_id').on(t.harnessId, t.id),
    check('harness_items_claimant_kind_known', oneOf(t.claimantKind, principalKindSchema.options)),
    check(
      'harness_items_holder_has_kind',
      sql`(${t.claimedBy} IS NULL) = (${t.claimantKind} IS NULL)`,
    ),
    check('harness_items_claimed_by_is_identity', matches(t.claimedBy, IDENTITY_PATTERN)),
    check(
      'harness_items_lease_only_when_held',
      sql`${t.leaseExpires} IS NULL OR ${t.claimedBy} IS NOT NULL`,
    ),
    check(
      'harness_items_person_has_no_lease',
      sql`${t.claimantKind} IS DISTINCT FROM 'person' OR ${t.leaseExpires} IS NULL`,
    ),
    check('harness_items_gate_status_known', oneOf(t.gateStatus, gateStatusSchema.options)),
    check('harness_items_gate_target_form', matches(t.gateTarget, STAGE_KEY_PATTERN)),
    check('harness_items_branch_state_known', oneOf(t.branchState, branchStateSchema.options)),
    check('harness_items_risk_tier_known', oneOf(t.riskTier, riskTierSchema.options)),
    check('harness_items_risk_domains_known', subsetOf(t.riskDomains, riskDomainSchema.options)),
    check('harness_items_pr_whole', sql`(${t.prRepo} IS NULL) = (${t.prNumber} IS NULL)`),
    check(
      'harness_items_issue_whole',
      sql`(${t.issueRepo} IS NULL) = (${t.issueNumber} IS NULL) AND (${t.issueNumber} IS NULL) = (${t.issueGithubId} IS NULL)`,
    ),
    uniqueIndex('harness_items_issue_once')
      .on(t.issueGithubId)
      .where(sql`${t.issueGithubId} IS NOT NULL`),
    index('harness_items_stage').on(t.harnessId, t.stageId),
    index('harness_items_lease').on(t.leaseExpires),
  ],
);

export const harnessRuns = declareTable(
  'harness_runs',
  {
    id: uuid('id').primaryKey(),
    harnessId: uuid('harness_id').notNull(),
    itemId: uuid('item_id').notNull(),
    persona: text('persona').notNull(),
    runShape: text('run_shape').notNull(),
    engine: text('engine').notNull(),
    model: text('model').notNull(),
    resolvedProvider: text('resolved_provider'),
    steps: jsonb('steps')
      .notNull()
      .default(sql`'[]'::jsonb`),
    costMinor: bigint('cost_minor', { mode: 'number' }),
    costBasis: text('cost_basis').notNull(),
    traceId: uuid('trace_id').notNull(),
    outcome: text('outcome').notNull(),
    startedAt: instant('started_at').notNull(),
    endedAt: instant('ended_at'),
  },
  { classification: 'internal', offlineEligibility: 'never' },
  (t) => [
    foreignKey({
      name: 'harness_runs_item_fk',
      columns: [t.harnessId, t.itemId],
      foreignColumns: [harnessItems.harnessId, harnessItems.id],
    }),
    check('harness_runs_persona_form', matches(t.persona, IDENTITY_PATTERN)),
    check('harness_runs_run_shape_known', oneOf(t.runShape, runShapeSchema.options)),
    check('harness_runs_engine_known', oneOf(t.engine, engineSchema.options)),
    check('harness_runs_cost_basis_known', oneOf(t.costBasis, costBasisSchema.options)),
    check('harness_runs_outcome_known', oneOf(t.outcome, runOutcomeSchema.options)),
    index('harness_runs_item').on(t.itemId),
  ],
);

export const gateDecisions = declareTable(
  'gate_decisions',
  {
    id: uuid('id').primaryKey(),
    harnessId: uuid('harness_id').notNull(),
    itemId: uuid('item_id').notNull(),
    stageId: uuid('stage_id').notNull(),
    actor: text('actor').notNull(),
    decision: text('decision').notNull(),
    reason: text('reason'),
    evidence: jsonb('evidence').notNull(),
    traceId: uuid('trace_id').notNull(),
    decidedAt: instant('decided_at').notNull(),
  },
  restrictedNever,
  (t) => [
    foreignKey({
      name: 'gate_decisions_item_fk',
      columns: [t.harnessId, t.itemId],
      foreignColumns: [harnessItems.harnessId, harnessItems.id],
    }),
    foreignKey({
      name: 'gate_decisions_stage_fk',
      columns: [t.harnessId, t.stageId],
      foreignColumns: [harnessStages.harnessId, harnessStages.id],
    }),
    check('gate_decisions_decision_known', oneOf(t.decision, gateDecisionSchema.options)),
    check('gate_decisions_actor_is_human', matches(t.actor, HUMAN_IDENTITY_PATTERN)),
    check(
      'gate_decisions_override_has_reason',
      sql`${t.decision} <> 'override' OR length(btrim(coalesce(${t.reason}, ''))) > 0`,
    ),
    index('gate_decisions_item').on(t.itemId),
  ],
);

export const measurements = declareTable(
  'measurements',
  {
    id: uuid('id').primaryKey(),
    harnessId: uuid('harness_id')
      .notNull()
      .references(() => harnesses.id),
    itemId: uuid('item_id'),
    source: text('source').notNull(),
    name: text('name').notNull(),
    value: doublePrecision('value').notNull(),
    asOf: date('as_of', { mode: 'string' }).notNull(),
    recordedAt: instant('recorded_at').notNull(),
  },
  { classification: 'internal', offlineEligibility: 'cache_readonly' },
  (t) => [
    foreignKey({
      name: 'measurements_item_fk',
      columns: [t.harnessId, t.itemId],
      foreignColumns: [harnessItems.harnessId, harnessItems.id],
    }),
    check('measurements_source_known', oneOf(t.source, dataSourceKindSchema.options)),
    index('measurements_item').on(t.itemId),
  ],
);

export const personas = declareTable(
  'personas',
  {
    identity: text('identity').primaryKey(),
    harnessId: uuid('harness_id')
      .notNull()
      .references(() => harnesses.id),
    pageId: uuid('page_id')
      .notNull()
      .unique()
      .references(() => pages.id),
  },
  internalSync,
  (t) => [check('personas_identity_form', matches(t.identity, PERSONA_IDENTITY_PATTERN))],
);

export const harnessEvents = declareTable(
  'harness_events',
  {
    id: uuid('id').primaryKey(),
    harnessId: uuid('harness_id')
      .notNull()
      .references(() => harnesses.id),
    itemId: uuid('item_id'),
    position: bigint('position', { mode: 'number' }).notNull().default(0),
    name: text('name').notNull(),
    actor: text('actor').notNull(),
    evidence: jsonb('evidence').notNull(),
    traceId: uuid('trace_id').notNull(),
    at: instant('at').notNull(),
  },
  internalSync,
  (t) => [
    foreignKey({
      name: 'harness_events_item_fk',
      columns: [t.harnessId, t.itemId],
      foreignColumns: [harnessItems.harnessId, harnessItems.id],
    }),
    check('harness_events_name_known', oneOf(t.name, eventNameSchema.options)),
    check('harness_events_actor_is_identity', matches(t.actor, IDENTITY_PATTERN)),
    check('harness_events_position_positive', sql`${t.position} >= 1`),
    uniqueIndex('harness_events_position_per_harness').on(t.harnessId, t.position),
    index('harness_events_item').on(t.itemId, t.position),
  ],
);
