import { sql } from 'drizzle-orm';
import { check, date, text, uuid } from 'drizzle-orm/pg-core';
import { IDENTITY_PATTERN, matches } from './checks.ts';
import { instant } from './columns.ts';
import { declareTable } from './declarations.ts';
import { pages, people } from './schema-platform.ts';

const bounded = (column: Parameters<typeof matches>[0], most: number) =>
  sql`${column} IS NULL OR length(btrim(${column})) BETWEEN 1 AND ${sql.raw(String(most))}`;

const OPTION_PATTERN = '^[a-z0-9][a-z0-9_-]*$';

export const directoryEntries = declareTable(
  'directory_entries',
  {
    personId: uuid('person_id')
      .primaryKey()
      .references(() => people.id),
    role: text('role'),
    team: text('team'),
    employment: text('employment'),
    ring: text('ring'),
    joined: date('joined', { mode: 'string' }),
    url: text('url'),
    portfolios: uuid('portfolios')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    pageId: uuid('page_id').references(() => pages.id),
    updatedBy: text('updated_by').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  { classification: 'internal', offlineEligibility: 'cache_readonly' },
  (t) => [
    check('directory_entries_role_bounded', bounded(t.role, 200)),
    check('directory_entries_url_bounded', bounded(t.url, 2000)),
    check(
      'directory_entries_team_form',
      sql`${t.team} IS NULL OR ${matches(t.team, OPTION_PATTERN)}`,
    ),
    check(
      'directory_entries_employment_form',
      sql`${t.employment} IS NULL OR ${matches(t.employment, OPTION_PATTERN)}`,
    ),
    check(
      'directory_entries_ring_form',
      sql`${t.ring} IS NULL OR ${matches(t.ring, OPTION_PATTERN)}`,
    ),
    check('directory_entries_updated_by_is_identity', matches(t.updatedBy, IDENTITY_PATTERN)),
  ],
);

export const directoryPrivate = declareTable(
  'directory_private',
  {
    personId: uuid('person_id')
      .primaryKey()
      .references(() => people.id),
    phone: text('phone'),
    mailingAddress: text('mailing_address'),
    complianceStatus: text('compliance_status'),
    complianceDue: date('compliance_due', { mode: 'string' }),
    updatedBy: text('updated_by').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  { classification: 'restricted', offlineEligibility: 'never' },
  (t) => [
    check('directory_private_phone_bounded', bounded(t.phone, 40)),
    check('directory_private_address_bounded', bounded(t.mailingAddress, 1000)),
    check(
      'directory_private_compliance_form',
      sql`${t.complianceStatus} IS NULL OR ${matches(t.complianceStatus, OPTION_PATTERN)}`,
    ),
    check('directory_private_updated_by_is_identity', matches(t.updatedBy, IDENTITY_PATTERN)),
  ],
);
