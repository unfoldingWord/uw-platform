import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  commandNameSchema,
  ingestSourceSchema,
  pageStatusSchema,
  pageTypeSchema,
  personStatusSchema,
  roleSchema,
  scopeSchema,
  taskStatusSchema,
} from '@uw/contracts';
import { searchDocument } from './page-search.ts';
import {
  DEVICE_PATTERN,
  HUMAN_IDENTITY_PATTERN,
  IDENTITY_PATTERN,
  JD_AREA_PATTERN,
  JD_CATEGORY_PATTERN,
  SLUG_PATTERN,
  matches,
  oneOf,
} from './checks.ts';
import { instant } from './columns.ts';
import { declareTable } from './declarations.ts';

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
    check('grant_audit_action_known', oneOf(t.action, ['grant', 'revoke', 'bootstrap', 'default'])),
    check('grant_audit_actor_is_identity', matches(t.actor, IDENTITY_PATTERN)),
    index('grant_audit_grant').on(t.grantId),
  ],
);

export const personAudit = declareTable(
  'person_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actor: text('actor').notNull(),
    at: instant('at').notNull(),
    action: text('action').notNull(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    before: text('before').notNull(),
    after: text('after').notNull(),
    traceId: uuid('trace_id').notNull(),
  },
  { classification: 'restricted', offlineEligibility: 'never' },
  (t) => [
    check('person_audit_action_known', oneOf(t.action, ['approve', 'decline'])),
    check('person_audit_actor_is_human', matches(t.actor, HUMAN_IDENTITY_PATTERN)),
    check('person_audit_before_known', oneOf(t.before, personStatusSchema.options)),
    check('person_audit_after_known', oneOf(t.after, personStatusSchema.options)),
    index('person_audit_person').on(t.personId),
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
    index('pages_search').using('gin', searchDocument(t)),
    index('pages_area_updated').on(t.jdArea, t.updatedAt),
  ],
);

export const jdCategories = declareTable(
  'jd_categories',
  {
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  { classification: 'internal', offlineEligibility: 'sync' },
  (t) => [
    check('jd_categories_code_form', matches(t.code, JD_CATEGORY_PATTERN)),
    check('jd_categories_name_not_blank', sql`length(btrim(${t.name})) BETWEEN 1 AND 80`),
  ],
);

export const pageViews = declareTable(
  'page_views',
  {
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id),
    viewedAt: instant('viewed_at').notNull(),
  },
  { classification: 'internal', offlineEligibility: 'cache_readonly' },
  (t) => [
    primaryKey({ name: 'page_views_pkey', columns: [t.personId, t.pageId] }),
    index('page_views_recent').on(t.personId, t.viewedAt),
  ],
);

export const pageLinks = declareTable(
  'page_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromPage: uuid('from_page')
      .notNull()
      .references(() => pages.id),
    toPage: uuid('to_page').references(() => pages.id),
    rel: text('rel').notNull(),
    wanted: text('wanted'),
  },
  { classification: 'internal', offlineEligibility: 'sync' },
  (t) => [
    check('page_links_rel_known', oneOf(t.rel, ['links', 'embeds', 'unresolved'])),
    check(
      'page_links_unresolved_names_no_page',
      sql`(${t.rel} = 'unresolved') = (${t.toPage} IS NULL)`,
    ),
    index('page_links_from').on(t.fromPage),
    index('page_links_to').on(t.toPage, t.rel),
  ],
);

export const areaHomes = declareTable(
  'area_homes',
  {
    area: text('area').primaryKey(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id),
    setBy: text('set_by').notNull(),
    setAt: instant('set_at').notNull(),
  },
  { classification: 'internal', offlineEligibility: 'cache_readonly' },
  (t) => [
    check('area_homes_area_form', matches(t.area, JD_AREA_PATTERN)),
    check('area_homes_set_by_is_identity', matches(t.setBy, IDENTITY_PATTERN)),
  ],
);

export const pageFavourites = declareTable(
  'page_favourites',
  {
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  { classification: 'internal', offlineEligibility: 'sync' },
  (t) => [primaryKey({ name: 'page_favourites_pkey', columns: [t.personId, t.pageId] })],
);

export const pageComments = declareTable(
  'page_comments',
  {
    id: uuid('id').primaryKey(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id),
    author: text('author').notNull(),
    bodyMd: text('body_md').notNull(),
    quote: text('quote'),
    createdAt: instant('created_at').notNull(),
    resolvedAt: instant('resolved_at'),
    resolvedBy: text('resolved_by'),
  },
  { classification: 'internal', offlineEligibility: 'sync' },
  (t) => [
    check('page_comments_author_is_identity', matches(t.author, IDENTITY_PATTERN)),
    check('page_comments_body_bounded', sql`length(btrim(${t.bodyMd})) BETWEEN 1 AND 10000`),
    check(
      'page_comments_quote_bounded',
      sql`${t.quote} IS NULL OR length(btrim(${t.quote})) BETWEEN 1 AND 500`,
    ),
    check(
      'page_comments_resolved_together',
      sql`(${t.resolvedAt} IS NULL) = (${t.resolvedBy} IS NULL)`,
    ),
    index('page_comments_page').on(t.pageId, t.createdAt),
  ],
);

export const pageFiles = declareTable(
  'page_files',
  {
    id: uuid('id').primaryKey(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id),
    jdArea: text('jd_area').notNull(),
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    uploadedBy: text('uploaded_by').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
  },
  { classification: 'internal', offlineEligibility: 'sync' },
  (t) => [
    check('page_files_area_form', matches(t.jdArea, JD_AREA_PATTERN)),
    check('page_files_size_bounded', sql`${t.size} BETWEEN 1 AND 20971520`),
    check('page_files_sha256_form', matches(t.sha256, '^[0-9a-f]{64}$')),
    check('page_files_uploaded_by_is_identity', matches(t.uploadedBy, IDENTITY_PATTERN)),
    check('page_files_name_not_blank', sql`length(btrim(${t.name})) BETWEEN 1 AND 200`),
    index('page_files_page').on(t.pageId),
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
    requestId: uuid('request_id'),
    savedAt: instant('saved_at').notNull().defaultNow(),
  },
  { classification: 'internal', offlineEligibility: 'sync' },
  (t) => [
    check('page_versions_type_known', oneOf(t.type, pageTypeSchema.options)),
    check('page_versions_status_known', oneOf(t.status, pageStatusSchema.options)),
    check('page_versions_area_form', matches(t.jdArea, JD_AREA_PATTERN)),
    check('page_versions_slug_form', matches(t.slug, SLUG_PATTERN)),
    check('page_versions_version_positive', sql`${t.version} >= 1`),
    uniqueIndex('page_versions_page_version').on(t.pageId, t.version),
    check('page_versions_edit_source_is_identity', matches(t.editSource, IDENTITY_PATTERN)),
    uniqueIndex('page_versions_request')
      .on(t.editSource, t.requestId)
      .where(sql`${t.requestId} IS NOT NULL`),
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
    index('webhook_deliveries_received_at').on(t.receivedAt),
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

export const tasks = declareTable(
  'tasks',
  {
    id: uuid('id').primaryKey(),
    jdArea: text('jd_area').notNull(),
    title: text('title').notNull(),
    pageId: uuid('page_id').references(() => pages.id),
    due: date('due', { mode: 'string' }),
    status: text('status').notNull(),
    createdBy: text('created_by').notNull(),
    traceId: uuid('trace_id').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  { classification: 'internal', offlineEligibility: 'sync' },
  (t) => [
    check('tasks_status_known', oneOf(t.status, taskStatusSchema.options)),
    check('tasks_area_form', matches(t.jdArea, JD_AREA_PATTERN)),
    check('tasks_created_by_is_identity', matches(t.createdBy, IDENTITY_PATTERN)),
    check('tasks_title_not_blank', sql`length(btrim(${t.title})) > 0`),
    index('tasks_area_status').on(t.jdArea, t.status),
  ],
);

export const serviceTokens = declareTable(
  'service_tokens',
  {
    id: uuid('id').primaryKey(),
    clientId: text('client_id').notNull(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    device: text('device').notNull(),
    boundBy: text('bound_by').notNull(),
    boundAt: instant('bound_at').notNull(),
    revokedAt: instant('revoked_at'),
    traceId: uuid('trace_id').notNull(),
  },
  { classification: 'restricted', offlineEligibility: 'never' },
  (t) => [
    check('service_tokens_device_form', matches(t.device, DEVICE_PATTERN)),
    check('service_tokens_bound_by_is_human', matches(t.boundBy, HUMAN_IDENTITY_PATTERN)),
    uniqueIndex('service_tokens_one_live_device')
      .on(t.personId, t.device)
      .where(sql`${t.revokedAt} IS NULL`),
    uniqueIndex('service_tokens_one_live_client')
      .on(t.clientId)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);

const retiredCommandNames = ['create_stage', 'update_stage', 'reorder_stages', 'remove_stage'];

export const commandRequests = declareTable(
  'command_requests',
  {
    actor: text('actor').notNull(),
    requestId: uuid('request_id').notNull(),
    command: text('command').notNull(),
    harnessId: uuid('harness_id').notNull(),
    outcome: jsonb('outcome'),
    traceId: uuid('trace_id').notNull(),
    claimedAt: instant('claimed_at').notNull(),
    settledAt: instant('settled_at'),
  },
  { classification: 'internal', offlineEligibility: 'never' },
  (t) => [
    primaryKey({ name: 'command_requests_pkey', columns: [t.actor, t.requestId] }),
    check(
      'command_requests_command_known',
      oneOf(t.command, [...commandNameSchema.options, ...retiredCommandNames]),
    ),
    check('command_requests_actor_is_identity', matches(t.actor, IDENTITY_PATTERN)),
    check(
      'command_requests_settled_with_outcome',
      sql`(${t.outcome} IS NULL) = (${t.settledAt} IS NULL)`,
    ),
    check(
      'command_requests_outcome_bounded',
      sql`${t.outcome} IS NULL OR octet_length(${t.outcome}::text) <= 16384`,
    ),
  ],
);
