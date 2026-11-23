import { check, index, jsonb, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { mapRelationSchema, placedEntityKindSchema } from '@uw/contracts';
import { IDENTITY_PATTERN, JD_AREA_PATTERN, matches, oneOf } from './checks.ts';
import { instant } from './columns.ts';
import { declareTable } from './declarations.ts';
import { pages } from './schema-platform.ts';

export const jdCascadeMap = declareTable(
  'jd_cascade_map',
  {
    id: uuid('id').primaryKey(),
    jdArea: text('jd_area').notNull(),
    cascadePageId: uuid('cascade_page_id')
      .notNull()
      .references(() => pages.id),
    relation: text('relation').notNull(),
    note: text('note'),
    declaredBy: text('declared_by').notNull(),
    declaredAt: instant('declared_at').notNull(),
  },
  { classification: 'internal', offlineEligibility: 'sync' },
  (t) => [
    check('jd_cascade_map_area_form', matches(t.jdArea, JD_AREA_PATTERN)),
    check('jd_cascade_map_relation_known', oneOf(t.relation, mapRelationSchema.options)),
    check('jd_cascade_map_declared_by_identity', matches(t.declaredBy, IDENTITY_PATTERN)),
    uniqueIndex('jd_cascade_map_one_relation').on(t.jdArea, t.cascadePageId, t.relation),
    index('jd_cascade_map_node').on(t.cascadePageId),
  ],
);

export const jdCascadeMapAudit = declareTable(
  'jd_cascade_map_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actor: text('actor').notNull(),
    at: instant('at').notNull(),
    action: text('action').notNull(),
    mapId: uuid('map_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    traceId: uuid('trace_id').notNull(),
  },
  { classification: 'restricted', offlineEligibility: 'never' },
  (t) => [
    check('jd_cascade_map_audit_action_known', oneOf(t.action, ['declare', 'remove'])),
    check('jd_cascade_map_audit_actor_identity', matches(t.actor, IDENTITY_PATTERN)),
    index('jd_cascade_map_audit_map').on(t.mapId),
  ],
);

export const cascadePlacements = declareTable(
  'cascade_placements',
  {
    entityKind: text('entity_kind').notNull(),
    entityId: uuid('entity_id').notNull(),
    cascadePageId: uuid('cascade_page_id')
      .notNull()
      .references(() => pages.id),
    placedBy: text('placed_by').notNull(),
    placedAt: instant('placed_at').notNull(),
  },
  { classification: 'internal', offlineEligibility: 'sync' },
  (t) => [
    primaryKey({ name: 'cascade_placements_pk', columns: [t.entityKind, t.entityId] }),
    check('cascade_placements_kind_known', oneOf(t.entityKind, placedEntityKindSchema.options)),
    check('cascade_placements_placed_by_identity', matches(t.placedBy, IDENTITY_PATTERN)),
    index('cascade_placements_node').on(t.cascadePageId),
  ],
);
