import { sql } from 'drizzle-orm';
import { check, foreignKey, index, jsonb, text, unique, uuid } from 'drizzle-orm/pg-core';
import {
  ASSISTANT_PROPOSAL_DAYS,
  assistantProposalKindSchema,
  assistantProposalStatusSchema,
} from '@uw/contracts';
import { HUMAN_IDENTITY_PATTERN, matches, oneOf } from './checks.ts';
import { instant } from './columns.ts';
import { declareTable } from './declarations.ts';
import { assistantRequests } from './schema-assistants.ts';
import { harnesses } from './schema-harnesses.ts';

const restrictedNever = { classification: 'restricted', offlineEligibility: 'never' } as const;

export const assistantProposals = declareTable(
  'assistant_proposals',
  {
    id: uuid('id').primaryKey(),
    harnessId: uuid('harness_id').notNull(),
    personId: uuid('person_id').notNull(),
    requestId: uuid('request_id').notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    digest: text('digest').notNull().default(''),
    status: text('status').notNull(),
    decidedBy: text('decided_by'),
    decidedAt: instant('decided_at'),
    expiresAt: instant('expires_at').notNull(),
    createdAt: instant('created_at').notNull(),
    redactedAt: instant('redacted_at'),
  },
  restrictedNever,
  (t) => [
    foreignKey({
      name: 'assistant_proposals_personal_harness_fk',
      columns: [t.harnessId, t.personId],
      foreignColumns: [harnesses.id, harnesses.personId],
    }),
    foreignKey({
      name: 'assistant_proposals_request_harness_fk',
      columns: [t.requestId, t.harnessId],
      foreignColumns: [assistantRequests.id, assistantRequests.harnessId],
    }),
    check('assistant_proposals_kind_known', oneOf(t.kind, assistantProposalKindSchema.options)),
    check(
      'assistant_proposals_status_known',
      oneOf(t.status, assistantProposalStatusSchema.options),
    ),
    check(
      'assistant_proposals_decided_by_human',
      sql`${t.decidedBy} IS NULL OR ${matches(t.decidedBy, HUMAN_IDENTITY_PATTERN)}`,
    ),
    check(
      'assistant_proposals_decided_together',
      sql`(${t.status} IN ('accepted', 'declined')) = (${t.decidedBy} IS NOT NULL) AND (${t.decidedBy} IS NULL) = (${t.decidedAt} IS NULL)`,
    ),
    check(
      'assistant_proposals_expires_in_a_week',
      sql`${t.expiresAt} = ${t.createdAt} + ${sql.raw(`interval '${String(ASSISTANT_PROPOSAL_DAYS)} days'`)}`,
    ),
    check('assistant_proposals_digest_shape', sql`${t.digest} ~ '^[0-9a-f]{64}$'`),
    check('assistant_proposals_payload_object', sql`jsonb_typeof(${t.payload}) = 'object'`),
    check(
      'assistant_proposals_redacted_empty',
      sql`${t.redactedAt} IS NULL OR (${t.payload} = '{}'::jsonb AND ${t.status} <> 'pending')`,
    ),
    unique('assistant_proposals_id_harness').on(t.id, t.harnessId),
    index('assistant_proposals_harness').on(t.harnessId, t.status, t.createdAt),
    index('assistant_proposals_expiring')
      .on(t.expiresAt, t.id)
      .where(sql`${t.status} = 'pending'`),
  ],
);
