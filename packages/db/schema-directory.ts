import { sql } from 'drizzle-orm';
import { check, date, integer, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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

const cacheReadonly = { classification: 'internal', offlineEligibility: 'cache_readonly' } as const;

export const staffAllocations = declareTable(
  'staff_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    programPageId: uuid('program_page_id').references(() => pages.id),
    portfolioPageId: uuid('portfolio_page_id').references(() => pages.id),
    percent: integer('percent'),
    updatedBy: text('updated_by').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  cacheReadonly,
  (t) => [
    check(
      'staff_allocations_one_target',
      sql`(${t.programPageId} IS NULL) <> (${t.portfolioPageId} IS NULL)`,
    ),
    check(
      'staff_allocations_percent_range',
      sql`${t.percent} IS NULL OR ${t.percent} BETWEEN 0 AND 100`,
    ),
    check('staff_allocations_updated_by_is_identity', matches(t.updatedBy, IDENTITY_PATTERN)),
    uniqueIndex('staff_allocations_one_per_program').on(t.personId, t.programPageId),
    uniqueIndex('staff_allocations_one_per_portfolio').on(t.personId, t.portfolioPageId),
  ],
);

export const personCommitments = declareTable(
  'person_commitments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromPersonId: uuid('from_person_id')
      .notNull()
      .references(() => people.id),
    toPersonId: uuid('to_person_id').references(() => people.id),
    toText: text('to_text'),
    updatedBy: text('updated_by').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  cacheReadonly,
  (t) => [
    check('person_commitments_one_target', sql`(${t.toPersonId} IS NULL) <> (${t.toText} IS NULL)`),
    check('person_commitments_to_text_bounded', bounded(t.toText, 200)),
    check(
      'person_commitments_not_to_self',
      sql`${t.toPersonId} IS NULL OR ${t.toPersonId} <> ${t.fromPersonId}`,
    ),
    check('person_commitments_updated_by_is_identity', matches(t.updatedBy, IDENTITY_PATTERN)),
    uniqueIndex('person_commitments_one_per_pair').on(t.fromPersonId, t.toPersonId),
  ],
);
