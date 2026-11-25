import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { suggestionSetStatusSchema } from '@uw/contracts';
import { HUMAN_IDENTITY_PATTERN, IDENTITY_PATTERN, matches, oneOf } from './checks.ts';
import { instant } from './columns.ts';
import { declareTable } from './declarations.ts';
import { pages } from './schema-platform.ts';

export const pageSuggestionSets = declareTable(
  'page_suggestion_sets',
  {
    id: uuid('id').primaryKey(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id),
    baseVersion: integer('base_version').notNull(),
    title: text('title').notNull(),
    frontmatter: jsonb('frontmatter').notNull(),
    bodyMd: text('body_md').notNull(),
    proposedBy: text('proposed_by').notNull(),
    proposedAt: instant('proposed_at').notNull(),
    status: text('status').notNull(),
    decidedBy: text('decided_by'),
    decidedAt: instant('decided_at'),
    acceptedVersion: integer('accepted_version'),
  },
  { classification: 'internal', offlineEligibility: 'sync' },
  (t) => [
    check('page_suggestion_sets_status_known', oneOf(t.status, suggestionSetStatusSchema.options)),
    check('page_suggestion_sets_base_positive', sql`${t.baseVersion} >= 1`),
    check('page_suggestion_sets_proposed_by_identity', matches(t.proposedBy, IDENTITY_PATTERN)),
    check(
      'page_suggestion_sets_decided_by_human',
      sql`${t.decidedBy} IS NULL OR ${matches(t.decidedBy, HUMAN_IDENTITY_PATTERN)}`,
    ),
    check(
      'page_suggestion_sets_decided_together',
      sql`(${t.status} = 'pending') = (${t.decidedBy} IS NULL) AND (${t.decidedBy} IS NULL) = (${t.decidedAt} IS NULL)`,
    ),
    check(
      'page_suggestion_sets_accepted_has_version',
      sql`(${t.status} = 'accepted') = (${t.acceptedVersion} IS NOT NULL) AND (${t.acceptedVersion} IS NULL OR ${t.acceptedVersion} > ${t.baseVersion})`,
    ),
    uniqueIndex('page_suggestion_sets_one_pending_per_proposer')
      .on(t.pageId, t.proposedBy)
      .where(sql`${t.status} = 'pending'`),
    index('page_suggestion_sets_page').on(t.pageId, t.status, t.proposedAt),
  ],
);
