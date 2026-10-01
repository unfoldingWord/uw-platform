import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ingestSourceSchema,
  pageStatusSchema,
  pageTypeSchema,
  personStatusSchema,
  roleSchema,
  scopeSchema,
} from '@uw/contracts';
import { IDENTITY_PATTERN, JD_AREA_PATTERN, SLUG_PATTERN, matches, oneOf } from './checks.ts';
import { declareTable } from './declarations.ts';

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const people = declareTable(
  'people',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    displayName: text('display_name').notNull(),
    status: text('status').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  { classification: 'internal', offlineEligibility: 'cache_readonly' },
  (t) => [
    check('people_status_known', oneOf(t.status, personStatusSchema.options)),
    check('people_email_lowercase', sql`${t.email} = lower(${t.email})`),
  ],
);

export const roleGrants = declareTable(
  'role_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    role: text('role').notNull(),
    scopeKind: text('scope_kind').notNull(),
    scopeArea: text('scope_area'),
    grantedBy: uuid('granted_by').references(() => people.id),
    grantedAt: instant('granted_at').notNull().defaultNow(),
    expiresAt: instant('expires_at'),
    revokedAt: instant('revoked_at'),
  },
  { classification: 'restricted', offlineEligibility: 'never' },
  (t) => [
    check('role_grants_role_known', oneOf(t.role, roleSchema.options)),
    check('role_grants_scope_known', oneOf(t.scopeKind, scopeSchema.options)),
    check(
      'role_grants_area_matches_scope',
      sql`(${t.scopeKind} = 'org' AND ${t.scopeArea} IS NULL) OR (${t.scopeKind} = 'jd_area' AND ${t.scopeArea} IS NOT NULL AND ${matches(t.scopeArea, JD_AREA_PATTERN)})`,
    ),
    uniqueIndex('role_grants_one_live')
      .on(t.personId, t.role, t.scopeKind, sql`coalesce(${t.scopeArea}, '')`)
      .where(sql`${t.revokedAt} IS NULL`),
    index('role_grants_person').on(t.personId),
  ],
);

export const grantAudit = declareTable(
  'grant_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actor: text('actor').notNull(),
    at: instant('at').notNull().defaultNow(),
    action: text('action').notNull(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => roleGrants.id),
    before: jsonb('before'),
    after: jsonb('after'),
    traceId: uuid('trace_id'),
  },
  { classification: 'restricted', offlineEligibility: 'never' },
  (t) => [
    check('grant_audit_action_known', oneOf(t.action, ['grant', 'revoke', 'bootstrap'])),
    check('grant_audit_actor_is_identity', matches(t.actor, IDENTITY_PATTERN)),
    index('grant_audit_grant').on(t.grantId),
  ],
);

export const pages = declareTable(
  'pages',
  {
    id: uuid('id').primaryKey(),
    type: text('type').notNull(),
    jdArea: text('jd_area').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    parentId: uuid('parent_id'),
    frontmatter: jsonb('frontmatter').notNull(),
    bodyMd: text('body_md').notNull(),
    version: integer('version').notNull(),
    status: text('status').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  { classification: 'internal', offlineEligibility: 'sync' },
  (t) => [
    foreignKey({ name: 'pages_parent_fk', columns: [t.parentId], foreignColumns: [t.id] }),
    check('pages_type_known', oneOf(t.type, pageTypeSchema.options)),
    check('pages_status_known', oneOf(t.status, pageStatusSchema.options)),
    check('pages_area_form', matches(t.jdArea, JD_AREA_PATTERN)),
    check('pages_slug_form', matches(t.slug, SLUG_PATTERN)),
    check('pages_version_positive', sql`${t.version} >= 1`),
    uniqueIndex('pages_slug_per_area').on(t.jdArea, t.slug),
    index('pages_parent').on(t.parentId),
  ],
);

export const pageVersions = declareTable(
  'page_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id),
    version: integer('version').notNull(),
    type: text('type').notNull(),
    jdArea: text('jd_area').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    parentId: uuid('parent_id'),
    frontmatter: jsonb('frontmatter').notNull(),
    bodyMd: text('body_md').notNull(),
    status: text('status').notNull(),
    editSource: text('edit_source').notNull(),
    traceId: uuid('trace_id'),
    savedAt: instant('saved_at').notNull().defaultNow(),
  },
  { classification: 'internal', offlineEligibility: 'sync' },
  (t) => [
    uniqueIndex('page_versions_page_version').on(t.pageId, t.version),
    check('page_versions_edit_source_is_identity', matches(t.editSource, IDENTITY_PATTERN)),
  ],
);

export const webhookDeliveries = declareTable(
  'webhook_deliveries',
  {
    source: text('source').notNull(),
    deliveryId: text('delivery_id').notNull(),
    receivedAt: instant('received_at').notNull().defaultNow(),
  },
  { classification: 'internal', offlineEligibility: 'never' },
  (t) => [
    primaryKey({ name: 'webhook_deliveries_pk', columns: [t.source, t.deliveryId] }),
    check('webhook_deliveries_source_known', oneOf(t.source, ingestSourceSchema.options)),
  ],
);

export const queueWatermarks = declareTable(
  'queue_watermarks',
  {
    queue: text('queue').primaryKey(),
    lastEnqueuedAt: instant('last_enqueued_at').notNull(),
    lastConsumedAt: instant('last_consumed_at').notNull(),
  },
  { classification: 'internal', offlineEligibility: 'never' },
);
