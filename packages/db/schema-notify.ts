import { sql } from 'drizzle-orm';
import { check, index, integer, text, uuid } from 'drizzle-orm/pg-core';
import { instant } from './columns.ts';
import { declareTable } from './declarations.ts';
import { people } from './schema-platform.ts';

export const pushSubscriptions = declareTable(
  'push_subscriptions',
  {
    endpoint: text('endpoint').primaryKey(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    expiresAt: instant('expires_at'),
    createdAt: instant('created_at').notNull(),
  },
  { classification: 'restricted', offlineEligibility: 'never' },
  (t) => [
    index('push_subscriptions_person').on(t.personId, t.createdAt),
    check('push_subscriptions_endpoint_https', sql`${t.endpoint} LIKE 'https://%'`),
  ],
);

export const pushCooldowns = declareTable(
  'push_cooldowns',
  {
    personId: uuid('person_id')
      .primaryKey()
      .references(() => people.id),
    windowStartedAt: instant('window_started_at').notNull(),
    rank: integer('rank').notNull(),
  },
  { classification: 'internal', offlineEligibility: 'never' },
  (t) => [check('push_cooldowns_rank_known', sql`${t.rank} BETWEEN 1 AND 3`)],
);
