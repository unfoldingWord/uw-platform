import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { assistantChannelSchema, assistantDirectEffectSchema } from '@uw/contracts';
import { oneOf } from './checks.ts';
import { instant } from './columns.ts';
import { declareTable } from './declarations.ts';
import { harnesses } from './schema-harnesses.ts';
import { people } from './schema-platform.ts';

const restrictedNever = { classification: 'restricted', offlineEligibility: 'never' } as const;
const jsonArray = (column: AnyPgColumn, most: number) =>
  sql`jsonb_typeof(${column}) = 'array' AND jsonb_array_length(${column}) <= ${sql.raw(String(most))}`;
const lengthAtMost = (column: AnyPgColumn, most: number) =>
  sql`char_length(${column}) <= ${sql.raw(String(most))}`;

export const assistantSettings = declareTable(
  'assistant_settings',
  {
    harnessId: uuid('harness_id').primaryKey(),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    displayName: text('display_name').notNull(),
    instructionsMd: text('instructions_md').notNull(),
    timezone: text('timezone').notNull(),
    version: integer('version').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  restrictedNever,
  (t) => [
    foreignKey({
      name: 'assistant_settings_personal_harness_fk',
      columns: [t.harnessId, t.personId],
      foreignColumns: [harnesses.id, harnesses.personId],
    }),
    check('assistant_settings_version_positive', sql`${t.version} >= 1`),
    check(
      'assistant_settings_display_name_length',
      sql`char_length(${t.displayName}) BETWEEN 1 AND 60`,
    ),
    check('assistant_settings_instructions_length', lengthAtMost(t.instructionsMd, 8000)),
    check('assistant_settings_timezone_length', sql`char_length(${t.timezone}) BETWEEN 1 AND 64`),
  ],
);

export const assistantRequests = declareTable(
  'assistant_requests',
  {
    id: uuid('id').primaryKey(),
    harnessId: uuid('harness_id')
      .notNull()
      .references(() => harnesses.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    channel: text('channel').notNull(),
    externalId: text('external_id').notNull(),
    threadKey: text('thread_key'),
    replyAddress: text('reply_address').notNull(),
    note: text('note').notNull(),
    untrustedParts: jsonb('untrusted_parts').notNull(),
    receivedAt: instant('received_at').notNull(),
    recordedAt: instant('recorded_at').notNull(),
  },
  restrictedNever,
  (t) => [
    foreignKey({
      name: 'assistant_requests_personal_harness_fk',
      columns: [t.harnessId, t.personId],
      foreignColumns: [harnesses.id, harnesses.personId],
    }),
    check('assistant_requests_channel_known', oneOf(t.channel, assistantChannelSchema.options)),
    check('assistant_requests_untrusted_parts_bounded', jsonArray(t.untrustedParts, 20)),
    check(
      'assistant_requests_external_id_length',
      sql`char_length(${t.externalId}) BETWEEN 1 AND 200`,
    ),
    check('assistant_requests_thread_key_length', lengthAtMost(t.threadKey, 200)),
    check(
      'assistant_requests_reply_address_length',
      sql`char_length(${t.replyAddress}) BETWEEN 1 AND 254`,
    ),
    check('assistant_requests_note_length', lengthAtMost(t.note, 20000)),
    uniqueIndex('assistant_requests_external_once').on(t.channel, t.externalId),
    index('assistant_requests_thread').on(t.harnessId, t.threadKey, t.recordedAt),
  ],
);

export const assistantEffects = declareTable(
  'assistant_effects',
  {
    id: uuid('id').primaryKey(),
    harnessId: uuid('harness_id')
      .notNull()
      .references(() => harnesses.id),
    requestId: uuid('request_id')
      .notNull()
      .references(() => assistantRequests.id),
    kind: text('kind').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  restrictedNever,
  (t) => [
    check('assistant_effects_direct_only', oneOf(t.kind, assistantDirectEffectSchema.options)),
    check('assistant_effects_payload_object', sql`jsonb_typeof(${t.payload}) = 'object'`),
    check(
      'assistant_effects_idempotency_key_length',
      sql`char_length(${t.idempotencyKey}) BETWEEN 1 AND 200`,
    ),
    uniqueIndex('assistant_effects_key_once').on(t.harnessId, t.idempotencyKey),
    index('assistant_effects_request').on(t.requestId),
  ],
);
