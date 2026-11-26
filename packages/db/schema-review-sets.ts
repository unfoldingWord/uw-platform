import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { reviewSetStatusSchema, suggestedChangeKindSchema } from '@uw/contracts';
import { HUMAN_IDENTITY_PATTERN, IDENTITY_PATTERN, matches, oneOf } from './checks.ts';
import { instant } from './columns.ts';
import { declareTable } from './declarations.ts';
import { pages } from './schema-platform.ts';

export const pageReviewSets = declareTable(
  'page_review_sets',
  {
    id: uuid('id').primaryKey(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id),
    name: text('name').notNull(),
    baseVersion: integer('base_version').notNull(),
    title: text('title'),
    frontmatter: jsonb('frontmatter'),
    status: text('status').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: instant('created_at').notNull(),
    requestId: uuid('request_id').notNull(),
    revision: integer('revision').notNull().default(1),
    decidedBy: text('decided_by'),
    decidedAt: instant('decided_at'),
    acceptedVersion: integer('accepted_version'),
    decisionRequestId: uuid('decision_request_id'),
  },
  { classification: 'internal', offlineEligibility: 'sync' },
  (t) => [
    check('page_review_sets_status_known', oneOf(t.status, reviewSetStatusSchema.options)),
    check('page_review_sets_name_present', sql`char_length(${t.name}) BETWEEN 1 AND 200`),
    check('page_review_sets_base_positive', sql`${t.baseVersion} >= 1`),
    check('page_review_sets_revision_positive', sql`${t.revision} >= 1`),
    check('page_review_sets_created_by_identity', matches(t.createdBy, IDENTITY_PATTERN)),
    check(
      'page_review_sets_decided_by_human',
      sql`${t.decidedBy} IS NULL OR ${matches(t.decidedBy, HUMAN_IDENTITY_PATTERN)}`,
    ),
    check(
      'page_review_sets_decided_together',
      sql`(${t.status} = 'pending') = (${t.decidedBy} IS NULL) AND (${t.decidedBy} IS NULL) = (${t.decidedAt} IS NULL) AND (${t.decidedBy} IS NULL) = (${t.decisionRequestId} IS NULL)`,
    ),
    check(
      'page_review_sets_accepted_has_version',
      sql`(${t.status} = 'accepted') = (${t.acceptedVersion} IS NOT NULL) AND (${t.acceptedVersion} IS NULL OR ${t.acceptedVersion} > ${t.baseVersion})`,
    ),
    uniqueIndex('page_review_sets_request').on(t.requestId),
    uniqueIndex('page_review_sets_one_pending_per_agent')
      .on(t.pageId, t.createdBy)
      .where(sql`${t.status} = 'pending' AND ${t.createdBy} LIKE 'agent:%'`),
    index('page_review_sets_page').on(t.pageId, t.status, t.createdAt),
  ],
);

export const pageSuggestedChanges = declareTable(
  'page_suggested_changes',
  {
    id: uuid('id').primaryKey(),
    reviewSetId: uuid('review_set_id')
      .notNull()
      .references(() => pageReviewSets.id),
    position: integer('position').notNull(),
    kind: text('kind').notNull(),
    startOffset: integer('start_offset').notNull(),
    endOffset: integer('end_offset').notNull(),
    exact: text('exact').notNull(),
    prefix: text('prefix').notNull(),
    suffix: text('suffix').notNull(),
    proposedText: text('proposed_text').notNull(),
    note: text('note'),
    author: text('author').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  { classification: 'internal', offlineEligibility: 'sync' },
  (t) => [
    check('page_suggested_changes_kind_known', oneOf(t.kind, suggestedChangeKindSchema.options)),
    check(
      'page_suggested_changes_span',
      sql`${t.startOffset} >= 0 AND ${t.endOffset} >= ${t.startOffset} AND ${t.position} >= 0`,
    ),
    check(
      'page_suggested_changes_kind_fits',
      sql`CASE ${t.kind}
        WHEN 'insertion' THEN ${t.endOffset} = ${t.startOffset} AND ${t.exact} = '' AND ${t.proposedText} <> ''
        WHEN 'deletion' THEN ${t.endOffset} > ${t.startOffset} AND ${t.proposedText} = ''
        WHEN 'replacement' THEN ${t.endOffset} > ${t.startOffset} AND ${t.proposedText} <> ''
        ELSE ${t.proposedText} = '' AND ${t.note} IS NOT NULL
      END`,
    ),
    check('page_suggested_changes_author_identity', matches(t.author, IDENTITY_PATTERN)),
    uniqueIndex('page_suggested_changes_position').on(t.reviewSetId, t.position),
  ],
);

export const pageReviewDecisions = declareTable(
  'page_review_decisions',
  {
    id: uuid('id').primaryKey(),
    reviewSetId: uuid('review_set_id')
      .notNull()
      .references(() => pageReviewSets.id),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id),
    decision: text('decision').notNull(),
    decidedBy: text('decided_by').notNull(),
    decidedAt: instant('decided_at').notNull(),
    requestId: uuid('request_id').notNull(),
    traceId: text('trace_id').notNull(),
    acceptedVersion: integer('accepted_version'),
  },
  { classification: 'internal', offlineEligibility: 'never' },
  (t) => [
    check('page_review_decisions_decision_known', oneOf(t.decision, ['accepted', 'rejected'])),
    check('page_review_decisions_by_human', matches(t.decidedBy, HUMAN_IDENTITY_PATTERN)),
    check(
      'page_review_decisions_accepted_has_version',
      sql`(${t.decision} = 'accepted') = (${t.acceptedVersion} IS NOT NULL)`,
    ),
    uniqueIndex('page_review_decisions_one_per_set').on(t.reviewSetId),
  ],
);
