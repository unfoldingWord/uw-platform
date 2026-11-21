import { sql } from 'drizzle-orm';
import { check, date, index, text, uuid } from 'drizzle-orm/pg-core';
import { taskPrioritySchema, taskStatusSchema } from '@uw/contracts';
import { IDENTITY_PATTERN, JD_AREA_PATTERN, matches, oneOf } from './checks.ts';
import { instant } from './columns.ts';
import { declareTable } from './declarations.ts';
import { pages } from './schema-platform.ts';

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
    assignees: uuid('assignees')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    priority: text('priority').notNull().default('normal'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    description: text('description').notNull().default(''),
    files: uuid('files')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    related: uuid('related')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    source: text('source').notNull().default(''),
    updatedBy: text('updated_by'),
    updatedAt: instant('updated_at'),
    completedAt: instant('completed_at'),
  },
  { classification: 'internal', offlineEligibility: 'sync' },
  (t) => [
    check('tasks_status_known', oneOf(t.status, taskStatusSchema.options)),
    check('tasks_priority_known', oneOf(t.priority, taskPrioritySchema.options)),
    check('tasks_description_bounded', sql`length(${t.description}) <= 10000`),
    check('tasks_source_bounded', sql`length(${t.source}) <= 200`),
    check(
      'tasks_updated_by_is_identity',
      sql`${t.updatedBy} IS NULL OR ${matches(t.updatedBy, IDENTITY_PATTERN)}`,
    ),
    index('tasks_assignees').using('gin', t.assignees),
    index('tasks_page').on(t.pageId),
    check('tasks_area_form', matches(t.jdArea, JD_AREA_PATTERN)),
    check('tasks_created_by_is_identity', matches(t.createdBy, IDENTITY_PATTERN)),
    check('tasks_title_not_blank', sql`length(btrim(${t.title})) > 0`),
    index('tasks_area_status').on(t.jdArea, t.status),
  ],
);
