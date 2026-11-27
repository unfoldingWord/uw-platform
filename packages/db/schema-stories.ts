import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import {
  consentForms,
  EXPRESSION_EXCERPT_MOST,
  expressionFormats,
  expressionKinds,
  expressionStatuses,
  locationPrecisions,
  nameUses,
  renderChannels,
  sensitivityLevels,
  storyUseKinds,
} from '@uw/contracts';
import { IDENTITY_PATTERN, matches, oneOf } from './checks.ts';
import { instant } from './columns.ts';
import { declareTable } from './declarations.ts';
import { pageFiles, pages } from './schema-platform.ts';

const internalNever = { classification: 'internal', offlineEligibility: 'never' } as const;
const restrictedNever = { classification: 'restricted', offlineEligibility: 'never' } as const;

export const storyLevels = declareTable(
  'story_levels',
  {
    pageId: uuid('page_id')
      .primaryKey()
      .references(() => pages.id),
    level: text('level').notNull(),
    updatedBy: text('updated_by').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  internalNever,
  (t) => [
    check('story_levels_level_known', oneOf(t.level, sensitivityLevels)),
    check('story_levels_updated_by_identity', matches(t.updatedBy, IDENTITY_PATTERN)),
  ],
);

export const storyConsents = declareTable(
  'story_consents',
  {
    pageId: uuid('page_id')
      .primaryKey()
      .references(() => pages.id),
    consentReference: text('consent_reference').notNull(),
    consentedBy: text('consented_by').notNull(),
    consentForm: text('consent_form').notNull(),
    consentedOn: date('consented_on', { mode: 'string' }).notNull(),
    consentExpires: date('consent_expires', { mode: 'string' }),
    anonymised: boolean('anonymised').notNull(),
    nameUse: text('name_use').notNull(),
    locationPrecision: text('location_precision').notNull(),
    photoRelease: boolean('photo_release').notNull(),
    photoReference: text('photo_reference'),
    reviewOn: date('review_on', { mode: 'string' }),
    withdrawnAt: instant('withdrawn_at'),
    updatedBy: text('updated_by').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  restrictedNever,
  (t) => [
    check('story_consents_form_known', oneOf(t.consentForm, consentForms)),
    check('story_consents_name_use_known', oneOf(t.nameUse, nameUses)),
    check('story_consents_location_known', oneOf(t.locationPrecision, locationPrecisions)),
    check('story_consents_reference_given', sql`length(trim(${t.consentReference})) > 0`),
    check(
      'story_consents_photo_reference_with_release',
      sql`${t.photoReference} IS NULL OR ${t.photoRelease}`,
    ),
    check('story_consents_updated_by_identity', matches(t.updatedBy, IDENTITY_PATTERN)),
  ],
);

export const storyMediaLevels = declareTable(
  'story_media_levels',
  {
    fileId: uuid('file_id')
      .primaryKey()
      .references(() => pageFiles.id),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id),
    level: text('level').notNull(),
    updatedBy: text('updated_by').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  internalNever,
  (t) => [
    check('story_media_levels_level_known', oneOf(t.level, sensitivityLevels)),
    check('story_media_levels_updated_by_identity', matches(t.updatedBy, IDENTITY_PATTERN)),
    index('story_media_levels_page').on(t.pageId),
  ],
);

export const storyUses = declareTable(
  'story_uses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id),
    version: integer('version').notNull(),
    channel: text('channel').notNull(),
    kind: text('kind').notNull(),
    reference: text('reference').notNull(),
    usedBy: text('used_by').notNull(),
    usedAt: instant('used_at').notNull(),
  },
  internalNever,
  (t) => [
    check('story_uses_version_counted', sql`${t.version} >= 1`),
    check('story_uses_channel_known', oneOf(t.channel, renderChannels)),
    check('story_uses_kind_known', oneOf(t.kind, storyUseKinds)),
    check('story_uses_used_by_identity', matches(t.usedBy, IDENTITY_PATTERN)),
    index('story_uses_page').on(t.pageId, t.usedAt),
  ],
);

export const storyExpressions = declareTable(
  'story_expressions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id),
    title: text('title').notNull(),
    format: text('format').notNull(),
    venue: text('venue').notNull(),
    channel: text('channel').notNull(),
    kind: text('kind').notNull(),
    url: text('url'),
    nativePageId: uuid('page_id_native').references(() => pages.id),
    language: text('language'),
    publishedOn: date('published_on', { mode: 'string' }),
    excerpt: text('excerpt'),
    status: text('status').notNull(),
    addedBy: text('added_by').notNull(),
    addedAt: instant('added_at').notNull(),
    decidedBy: text('decided_by'),
    decidedAt: instant('decided_at'),
  },
  internalNever,
  (t) => [
    check('story_expressions_format_known', oneOf(t.format, expressionFormats)),
    check('story_expressions_channel_known', oneOf(t.channel, renderChannels)),
    check('story_expressions_kind_known', oneOf(t.kind, expressionKinds)),
    check('story_expressions_status_known', oneOf(t.status, expressionStatuses)),
    check(
      'story_expressions_one_location',
      sql`(${t.kind} = 'link' AND ${t.url} IS NOT NULL AND ${t.nativePageId} IS NULL) OR (${t.kind} = 'native' AND ${t.url} IS NULL AND ${t.nativePageId} IS NOT NULL)`,
    ),
    check('story_expressions_url_https', sql`${t.url} IS NULL OR ${t.url} LIKE 'https://%'`),
    check('story_expressions_title_given', sql`length(trim(${t.title})) > 0`),
    check('story_expressions_venue_given', sql`length(trim(${t.venue})) > 0`),
    check(
      'story_expressions_excerpt_short',
      sql`${t.excerpt} IS NULL OR length(${t.excerpt}) <= ${sql.raw(String(EXPRESSION_EXCERPT_MOST))}`,
    ),
    check('story_expressions_added_by_identity', matches(t.addedBy, IDENTITY_PATTERN)),
    check(
      'story_expressions_decided_together',
      sql`(${t.decidedBy} IS NULL) = (${t.decidedAt} IS NULL)`,
    ),
    check(
      'story_expressions_decided_by_identity',
      sql`${t.decidedBy} IS NULL OR ${matches(t.decidedBy, IDENTITY_PATTERN)}`,
    ),
    uniqueIndex('story_expressions_page_url').on(t.pageId, t.url),
    index('story_expressions_page').on(t.pageId, t.publishedOn),
  ],
);
