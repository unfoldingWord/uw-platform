import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { pdfExportKinds, pdfExportStatuses } from '@uw/contracts';
import { IDENTITY_PATTERN, matches, oneOf } from './checks.ts';
import { instant } from './columns.ts';
import { declareTable } from './declarations.ts';
import { people } from './schema-platform.ts';

export const pdfExports = declareTable(
  'pdf_exports',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    title: text('title').notNull(),
    reference: text('reference').notNull(),
    requestedBy: text('requested_by').notNull(),
    personId: uuid('person_id').references(() => people.id),
    areas: text('areas').array().notNull(),
    request: jsonb('request').notNull(),
    r2Key: text('r2_key'),
    sourceSha256: text('source_sha256'),
    fileSha256: text('file_sha256'),
    bytes: integer('bytes'),
    failure: text('failure'),
    createdAt: instant('created_at').notNull(),
    finishedAt: instant('finished_at'),
    expiresAt: instant('expires_at').notNull(),
  },
  { classification: 'internal', offlineEligibility: 'never' },
  (t) => [
    check('pdf_exports_kind_known', oneOf(t.kind, pdfExportKinds)),
    check('pdf_exports_status_known', oneOf(t.status, pdfExportStatuses)),
    check('pdf_exports_requested_by_identity', matches(t.requestedBy, IDENTITY_PATTERN)),
    check('pdf_exports_source_sha256_form', matches(t.sourceSha256, '^[0-9a-f]{64}$')),
    check('pdf_exports_file_sha256_form', matches(t.fileSha256, '^[0-9a-f]{64}$')),
    check('pdf_exports_bytes_counted', sql`${t.bytes} >= 0`),
    check('pdf_exports_failure_form', matches(t.failure, '^[a-z][a-z_]*$')),
    check(
      'pdf_exports_ready_has_file',
      sql`${t.status} <> 'ready' OR ((${t.r2Key} IS NOT NULL OR ${t.kind} = 'screen') AND ${t.sourceSha256} IS NOT NULL AND ${t.fileSha256} IS NOT NULL AND ${t.bytes} IS NOT NULL AND ${t.finishedAt} IS NOT NULL)`,
    ),
    check('pdf_exports_screen_never_stored', sql`${t.kind} <> 'screen' OR ${t.r2Key} IS NULL`),
    check(
      'pdf_exports_failed_has_reason',
      sql`${t.status} <> 'failed' OR ${t.failure} IS NOT NULL`,
    ),
    check('pdf_exports_expires_after_creation', sql`${t.expiresAt} > ${t.createdAt}`),
    index('pdf_exports_expiry').on(t.status, t.expiresAt),
    index('pdf_exports_renders_by_person').on(t.personId, t.createdAt),
  ],
);
