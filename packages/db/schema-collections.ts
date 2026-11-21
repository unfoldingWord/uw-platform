import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
  chartKindSchema,
  collectionCommandNameSchema,
  filterOperatorSchema,
  groupBySchema,
  layoutSchema,
  propertyClassificationSchema,
  propertyTypeSchema,
  rowSourceSchema,
  sortDirectionSchema,
} from '@uw/contracts';
import { IDENTITY_PATTERN, JD_AREA_PATTERN, matches, oneOf } from './checks.ts';
import { instant } from './columns.ts';
import { declareTable } from './declarations.ts';

const KEY_PATTERN = '^[a-z][a-z0-9_]*$';
const internalSync = { classification: 'internal', offlineEligibility: 'sync' } as const;
const internalNever = { classification: 'internal', offlineEligibility: 'never' } as const;

export const collections = declareTable(
  'collections',
  {
    id: uuid('id').primaryKey(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    jdArea: text('jd_area').notNull(),
    rowSource: text('row_source').notNull(),
    pageType: text('page_type'),
    description: text('description').notNull(),
    locked: boolean('locked').notNull(),
    version: integer('version').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  internalSync,
  (t) => [
    uniqueIndex('collections_key').on(t.key),
    uniqueIndex('collections_page_type')
      .on(t.pageType)
      .where(sql`${t.pageType} IS NOT NULL AND ${t.pageType} <> 'entry'`),
    check('collections_key_form', matches(t.key, KEY_PATTERN)),
    check('collections_area_form', matches(t.jdArea, JD_AREA_PATTERN)),
    check('collections_row_source_known', oneOf(t.rowSource, rowSourceSchema.options)),
    check(
      'collections_page_type_with_pages',
      sql`(${t.rowSource} = 'pages') = (${t.pageType} IS NOT NULL)`,
    ),
    check('collections_version_positive', sql`${t.version} >= 1`),
    check('collections_created_by_is_identity', matches(t.createdBy, IDENTITY_PATTERN)),
  ],
);

export const collectionProperties = declareTable(
  'collection_properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    type: text('type').notNull(),
    classification: text('classification').notNull(),
    position: integer('position').notNull(),
    definition: jsonb('definition').notNull(),
  },
  internalSync,
  (t) => [
    uniqueIndex('collection_properties_key').on(t.collectionId, t.key),
    check('collection_properties_key_form', matches(t.key, KEY_PATTERN)),
    check('collection_properties_type_known', oneOf(t.type, propertyTypeSchema.options)),
    check(
      'collection_properties_classification_known',
      oneOf(t.classification, propertyClassificationSchema.options),
    ),
  ],
);

export const collectionVersions = declareTable(
  'collection_versions',
  {
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    definition: jsonb('definition').notNull(),
    savedBy: text('saved_by').notNull(),
    savedAt: instant('saved_at').notNull().defaultNow(),
  },
  internalNever,
  (t) => [
    primaryKey({ name: 'collection_versions_pkey', columns: [t.collectionId, t.version] }),
    check('collection_versions_saved_by_is_identity', matches(t.savedBy, IDENTITY_PATTERN)),
  ],
);

export const collectionTemplates = declareTable(
  'collection_templates',
  {
    id: uuid('id').primaryKey(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    values: jsonb('values').notNull(),
    bodyMd: text('body_md').notNull(),
    position: integer('position').notNull(),
  },
  internalSync,
  (t) => [
    index('collection_templates_collection').on(t.collectionId, t.position),
    check('collection_templates_name_bounded', sql`length(btrim(${t.name})) BETWEEN 1 AND 80`),
  ],
);

export const collectionViews = declareTable(
  'collection_views',
  {
    id: uuid('id').primaryKey(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id'),
    name: text('name').notNull(),
    layout: text('layout').notNull(),
    position: integer('position').notNull(),
    groupPropertyId: uuid('group_property_id').references(() => collectionProperties.id, {
      onDelete: 'set null',
    }),
    groupBy: text('group_by').notNull(),
    hideEmptyGroups: boolean('hide_empty_groups').notNull(),
    manualOrder: boolean('manual_order').notNull(),
    datePropertyId: uuid('date_property_id').references(() => collectionProperties.id, {
      onDelete: 'set null',
    }),
    chartKind: text('chart_kind'),
    chartSumPropertyId: uuid('chart_sum_property_id').references(() => collectionProperties.id, {
      onDelete: 'set null',
    }),
    cover: boolean('cover').notNull(),
    defaultTemplateId: uuid('default_template_id').references(() => collectionTemplates.id, {
      onDelete: 'set null',
    }),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  internalSync,
  (t) => [
    index('collection_views_collection').on(t.collectionId, t.position),
    check('collection_views_layout_known', oneOf(t.layout, layoutSchema.options)),
    check('collection_views_group_by_known', oneOf(t.groupBy, groupBySchema.options)),
    check(
      'collection_views_chart_kind_known',
      sql`${t.chartKind} IS NULL OR ${oneOf(t.chartKind, chartKindSchema.options)}`,
    ),
    check('collection_views_name_bounded', sql`length(btrim(${t.name})) BETWEEN 1 AND 80`),
  ],
);

const viewChild = () =>
  uuid('view_id')
    .notNull()
    .references(() => collectionViews.id, { onDelete: 'cascade' });
const propertyChild = () =>
  uuid('property_id')
    .notNull()
    .references(() => collectionProperties.id, { onDelete: 'cascade' });

export const collectionViewProperties = declareTable(
  'collection_view_properties',
  {
    viewId: viewChild(),
    propertyId: propertyChild(),
    visible: boolean('visible').notNull(),
    width: integer('width'),
    position: integer('position').notNull(),
  },
  internalSync,
  (t) => [
    primaryKey({ name: 'collection_view_properties_pkey', columns: [t.viewId, t.propertyId] }),
    check(
      'collection_view_properties_width_bounded',
      sql`${t.width} IS NULL OR ${t.width} BETWEEN 60 AND 800`,
    ),
  ],
);

export const collectionViewFilters = declareTable(
  'collection_view_filters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    viewId: viewChild(),
    parentId: uuid('parent_id'),
    kind: text('kind').notNull(),
    conjunction: text('conjunction'),
    propertyId: uuid('property_id').references(() => collectionProperties.id, {
      onDelete: 'cascade',
    }),
    operator: text('operator'),
    value: jsonb('value'),
    position: integer('position').notNull(),
  },
  internalSync,
  (t) => [
    foreignKey({
      name: 'collection_view_filters_parent_fk',
      columns: [t.parentId],
      foreignColumns: [t.id],
    }).onDelete('cascade'),
    index('collection_view_filters_view').on(t.viewId),
    check('collection_view_filters_kind_known', oneOf(t.kind, ['group', 'condition'])),
    check(
      'collection_view_filters_shape',
      sql`(${t.kind} = 'group' AND ${t.conjunction} IN ('and', 'or') AND ${t.propertyId} IS NULL AND ${t.operator} IS NULL) OR (${t.kind} = 'condition' AND ${t.conjunction} IS NULL AND ${t.propertyId} IS NOT NULL AND ${t.parentId} IS NOT NULL AND ${oneOf(t.operator, filterOperatorSchema.options)})`,
    ),
  ],
);

export const collectionViewSorts = declareTable(
  'collection_view_sorts',
  {
    viewId: viewChild(),
    propertyId: propertyChild(),
    direction: text('direction').notNull(),
    position: integer('position').notNull(),
  },
  internalSync,
  (t) => [
    primaryKey({ name: 'collection_view_sorts_pkey', columns: [t.viewId, t.propertyId] }),
    check('collection_view_sorts_direction_known', oneOf(t.direction, sortDirectionSchema.options)),
  ],
);

export const collectionViewGroups = declareTable(
  'collection_view_groups',
  {
    viewId: viewChild(),
    value: text('value').notNull(),
    visible: boolean('visible').notNull(),
    position: integer('position').notNull(),
    wipLimit: integer('wip_limit'),
  },
  internalSync,
  (t) => [
    primaryKey({ name: 'collection_view_groups_pkey', columns: [t.viewId, t.value] }),
    check(
      'collection_view_groups_wip_bounded',
      sql`${t.wipLimit} IS NULL OR ${t.wipLimit} BETWEEN 1 AND 500`,
    ),
  ],
);

export const collectionCardOrder = declareTable(
  'collection_card_order',
  {
    viewId: viewChild(),
    rowId: uuid('row_id').notNull(),
    position: text('position').notNull(),
  },
  internalSync,
  (t) => [
    primaryKey({ name: 'collection_card_order_pkey', columns: [t.viewId, t.rowId] }),
    index('collection_card_order_position').on(t.viewId, sql`${t.position} COLLATE "C"`),
    check('collection_card_order_position_form', matches(t.position, '^[0-9A-Za-z]+$')),
  ],
);

export const collectionRequests = declareTable(
  'collection_requests',
  {
    actor: text('actor').notNull(),
    requestId: uuid('request_id').notNull(),
    command: text('command').notNull(),
    outcome: jsonb('outcome').notNull(),
    settledAt: instant('settled_at').notNull().defaultNow(),
  },
  internalNever,
  (t) => [
    primaryKey({ name: 'collection_requests_pkey', columns: [t.actor, t.requestId] }),
    check('collection_requests_actor_is_identity', matches(t.actor, IDENTITY_PATTERN)),
    check(
      'collection_requests_command_known',
      oneOf(t.command, collectionCommandNameSchema.options),
    ),
    check('collection_requests_outcome_bounded', sql`octet_length(${t.outcome}::text) <= 16384`),
  ],
);
