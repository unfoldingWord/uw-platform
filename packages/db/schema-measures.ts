import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import {
  measurePausedReasons,
  measureRunKinds,
  measureRunStates,
  observationOutcomes,
  observationReasons,
} from '@uw/contracts';
import { IDENTITY_PATTERN, JD_AREA_PATTERN, matches, oneOf } from './checks.ts';
import { instant } from './columns.ts';
import { declareTable } from './declarations.ts';
import { pages, people } from './schema-platform.ts';

const SHA256_PATTERN = '^[0-9a-f]{64}$';
const internalNever = { classification: 'internal', offlineEligibility: 'never' } as const;

export const measureActivations = declareTable(
  'measure_activations',
  {
    measurePageId: uuid('measure_page_id')
      .primaryKey()
      .references(() => pages.id),
    version: integer('version').notNull(),
    toolHash: text('tool_hash').notNull(),
    lock: text('lock').notNull(),
    lockSha256: text('lock_sha256').notNull(),
    activatorPersonId: uuid('activator_person_id')
      .notNull()
      .references(() => people.id),
    area: text('area').notNull(),
    activatedAt: instant('activated_at').notNull(),
    nextRunAt: instant('next_run_at'),
    pausedReason: text('paused_reason'),
  },
  internalNever,
  (t) => [
    check('measure_activations_version_counted', sql`${t.version} >= 1`),
    check('measure_activations_tool_hash_form', matches(t.toolHash, SHA256_PATTERN)),
    check('measure_activations_lock_sha256_form', matches(t.lockSha256, SHA256_PATTERN)),
    check('measure_activations_area_form', matches(t.area, JD_AREA_PATTERN)),
    check('measure_activations_paused_reason_known', oneOf(t.pausedReason, measurePausedReasons)),
    index('measure_activations_due').on(t.nextRunAt),
  ],
);

export const measureRuns = declareTable(
  'measure_runs',
  {
    id: uuid('id').primaryKey(),
    measurePageId: uuid('measure_page_id')
      .notNull()
      .references(() => pages.id),
    measureVersion: integer('measure_version').notNull(),
    toolHash: text('tool_hash').notNull(),
    kind: text('kind').notNull(),
    requestedBy: text('requested_by').notNull(),
    state: text('state').notNull(),
    lock: text('lock'),
    lockSha256: text('lock_sha256'),
    refusedHosts: jsonb('refused_hosts')
      .notNull()
      .default(sql`'[]'::jsonb`),
    area: text('area').notNull(),
    createdAt: instant('created_at').notNull(),
    startedAt: instant('started_at'),
    finishedAt: instant('finished_at'),
  },
  internalNever,
  (t) => [
    check('measure_runs_version_counted', sql`${t.measureVersion} >= 1`),
    check('measure_runs_tool_hash_form', matches(t.toolHash, SHA256_PATTERN)),
    check('measure_runs_kind_known', oneOf(t.kind, measureRunKinds)),
    check('measure_runs_state_known', oneOf(t.state, measureRunStates)),
    check('measure_runs_requested_by_identity', matches(t.requestedBy, IDENTITY_PATTERN)),
    check('measure_runs_lock_sha256_form', matches(t.lockSha256, SHA256_PATTERN)),
    check('measure_runs_lock_hashed', sql`(${t.lock} IS NULL) = (${t.lockSha256} IS NULL)`),
    check('measure_runs_refused_hosts_list', sql`jsonb_typeof(${t.refusedHosts}) = 'array'`),
    check('measure_runs_area_form', matches(t.area, JD_AREA_PATTERN)),
    check(
      'measure_runs_finished_has_time',
      sql`${t.state} NOT IN ('ok', 'partial', 'failed') OR ${t.finishedAt} IS NOT NULL`,
    ),
    index('measure_runs_by_measure').on(t.measurePageId, t.kind, t.createdAt),
  ],
);

export const observationRecords = declareTable(
  'observations',
  {
    id: uuid('id').primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => measureRuns.id),
    measurePageId: uuid('measure_page_id')
      .notNull()
      .references(() => pages.id),
    measureVersion: integer('measure_version').notNull(),
    resourcePageId: uuid('resource_page_id')
      .notNull()
      .references(() => pages.id),
    observedAt: instant('observed_at').notNull(),
    toolVersion: text('tool_version'),
    values: jsonb('values'),
    outcome: text('outcome').notNull(),
    reason: text('reason'),
    rawKey: text('raw_key'),
    rawSha256: text('raw_sha256'),
    rawLength: integer('raw_length'),
    area: text('area').notNull(),
  },
  internalNever,
  (t) => [
    check('observations_version_counted', sql`${t.measureVersion} >= 1`),
    check('observations_outcome_known', oneOf(t.outcome, observationOutcomes)),
    check('observations_reason_known', oneOf(t.reason, observationReasons)),
    check(
      'observations_ok_has_values',
      sql`${t.outcome} <> 'ok' OR (${t.values} IS NOT NULL AND ${t.reason} IS NULL)`,
    ),
    check(
      'observations_failed_has_reason',
      sql`${t.outcome} <> 'failed' OR (${t.reason} IS NOT NULL AND ${t.values} IS NULL)`,
    ),
    check('observations_values_object', sql`jsonb_typeof(${t.values}) = 'object'`),
    check('observations_raw_hashed', sql`(${t.rawKey} IS NULL) = (${t.rawSha256} IS NULL)`),
    check('observations_raw_measured', sql`(${t.rawKey} IS NULL) = (${t.rawLength} IS NULL)`),
    check('observations_raw_length_counted', sql`${t.rawLength} >= 0`),
    check('observations_raw_sha256_form', matches(t.rawSha256, SHA256_PATTERN)),
    check('observations_area_form', matches(t.area, JD_AREA_PATTERN)),
    uniqueIndex('observations_one_per_run').on(t.runId, t.resourcePageId),
    index('observations_by_resource').on(t.measurePageId, t.resourcePageId, t.observedAt),
  ],
);
