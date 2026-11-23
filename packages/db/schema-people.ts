import { sql } from 'drizzle-orm';
import { check, text, uuid } from 'drizzle-orm/pg-core';
import { personStatusSchema } from '@uw/contracts';
import { oneOf } from './checks.ts';
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
