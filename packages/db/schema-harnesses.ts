import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { JD_AREA_PATTERN, REPOSITORY_PATTERN, SLUG_PATTERN, matches } from './checks.ts';
import { instant } from './columns.ts';
import { declareTable } from './declarations.ts';
import { people } from './schema-platform.ts';

const internalSync = { classification: 'internal', offlineEligibility: 'sync' } as const;
const internalNever = { classification: 'internal', offlineEligibility: 'never' } as const;
const emptyText = sql`'{}'::text[]`;
const jsonArray = (column: AnyPgColumn, most: number) =>
  sql`jsonb_typeof(${column}) = 'array' AND jsonb_array_length(${column}) <= ${sql.raw(String(most))}`;

export const harnesses = declareTable(
  'harnesses',
  {
    id: uuid('id').primaryKey(),
    key: text('key').notNull().unique(),
    title: text('title').notNull(),
    template: text('template').notNull(),
    jdArea: text('jd_area').notNull(),
    hostedBuilderEnabled: boolean('hosted_builder_enabled').notNull().default(false),
    paused: boolean('paused').notNull().default(false),
    createdAt: instant('created_at').notNull(),
    repository: text('repository'),
    shadow: boolean('shadow').notNull().default(false),
    externalReviewerIdentities: text('external_reviewer_identities')
      .array()
      .notNull()
      .default(emptyText),
    frozen: boolean('frozen').notNull().default(false),
    freezeAllow: uuid('freeze_allow')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    requiredChecks: jsonb('required_checks')
      .notNull()
      .default(sql`'[]'::jsonb`),
    protectedPaths: text('protected_paths').array().notNull().default(emptyText),
    fixClaim: boolean('fix_claim').notNull().default(false),
    botAuthors: text('bot_authors')
      .array()
      .notNull()
      .default(sql`'{dependabot[bot]}'::text[]`),
  },
  internalSync,
  (t) => [
    check('harnesses_freeze_allow_bounded', sql`cardinality(${t.freezeAllow}) <= 100`),
    check('harnesses_protected_paths_bounded', sql`cardinality(${t.protectedPaths}) <= 50`),
    check('harnesses_bot_authors_bounded', sql`cardinality(${t.botAuthors}) <= 20`),
    check('harnesses_required_checks_array', sql`jsonb_typeof(${t.requiredChecks}) = 'array'`),
    check(
      'harnesses_external_reviewers_bounded',
      sql`cardinality(${t.externalReviewerIdentities}) <= 20`,
    ),
    check('harnesses_area_form', matches(t.jdArea, JD_AREA_PATTERN)),
    check('harnesses_key_form', matches(t.key, SLUG_PATTERN)),
    check('harnesses_template_form', matches(t.template, SLUG_PATTERN)),
    check('harnesses_repository_form', matches(t.repository, REPOSITORY_PATTERN)),
    uniqueIndex('harnesses_repository_once')
      .on(sql`lower(${t.repository})`)
      .where(sql`${t.repository} IS NOT NULL`),
  ],
);

export const workflowDrafts = declareTable(
  'workflow_drafts',
  {
    harnessId: uuid('harness_id')
      .primaryKey()
      .references(() => harnesses.id),
    holderPersonId: uuid('holder_person_id')
      .notNull()
      .references(() => people.id),
    startedAt: instant('started_at').notNull(),
    touchedAt: instant('touched_at').notNull(),
    revision: integer('revision').notNull(),
    stages: jsonb('stages').notNull(),
    base: jsonb('base').notNull(),
  },
  internalNever,
  (t) => [
    check('workflow_drafts_revision_positive', sql`${t.revision} >= 1`),
    check('workflow_drafts_touched_after_start', sql`${t.touchedAt} >= ${t.startedAt}`),
    check('workflow_drafts_stages_bounded', jsonArray(t.stages, 50)),
    check('workflow_drafts_base_bounded', jsonArray(t.base, 50)),
  ],
);
