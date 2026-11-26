import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  jsonb,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  assistantChannelSchema,
  assistantDirectEffectSchema,
  assistantPairingViaSchema,
  assistantReminderStatusSchema,
} from '@uw/contracts';
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
    check(
      'assistant_requests_thread_key_length',
      sql`char_length(${t.threadKey}) BETWEEN 1 AND 200`,
    ),
    check(
      'assistant_requests_reply_address_length',
      sql`char_length(${t.replyAddress}) BETWEEN 1 AND 254`,
    ),
    check('assistant_requests_note_length', lengthAtMost(t.note, 20000)),
    uniqueIndex('assistant_requests_external_once').on(t.channel, t.externalId),
    unique('assistant_requests_id_harness').on(t.id, t.harnessId),
    index('assistant_requests_thread').on(t.harnessId, t.channel, t.threadKey, t.recordedAt, t.id),
  ],
);

export const assistantEffects = declareTable(
  'assistant_effects',
  {
    id: uuid('id').primaryKey(),
    harnessId: uuid('harness_id')
      .notNull()
      .references(() => harnesses.id),
    requestId: uuid('request_id').notNull(),
    kind: text('kind').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  restrictedNever,
  (t) => [
    foreignKey({
      name: 'assistant_effects_request_harness_fk',
      columns: [t.requestId, t.harnessId],
      foreignColumns: [assistantRequests.id, assistantRequests.harnessId],
    }),
    check('assistant_effects_direct_only', oneOf(t.kind, assistantDirectEffectSchema.options)),
    check('assistant_effects_payload_object', sql`jsonb_typeof(${t.payload}) = 'object'`),
    check(
      'assistant_effects_idempotency_key_length',
      sql`char_length(${t.idempotencyKey}) BETWEEN 1 AND 200`,
    ),
    uniqueIndex('assistant_effects_key_once').on(t.harnessId, t.idempotencyKey),
    unique('assistant_effects_id_harness').on(t.id, t.harnessId),
    index('assistant_effects_request').on(t.requestId),
  ],
);

export const assistantReminders = declareTable(
  'assistant_reminders',
  {
    id: uuid('id').primaryKey(),
    harnessId: uuid('harness_id').notNull(),
    personId: uuid('person_id').notNull(),
    requestId: uuid('request_id').notNull(),
    effectId: uuid('effect_id').notNull(),
    text: text('text').notNull(),
    dueAt: instant('due_at').notNull(),
    status: text('status').notNull(),
    closedAt: instant('closed_at'),
    createdAt: instant('created_at').notNull(),
  },
  restrictedNever,
  (t) => [
    foreignKey({
      name: 'assistant_reminders_personal_harness_fk',
      columns: [t.harnessId, t.personId],
      foreignColumns: [harnesses.id, harnesses.personId],
    }),
    foreignKey({
      name: 'assistant_reminders_request_harness_fk',
      columns: [t.requestId, t.harnessId],
      foreignColumns: [assistantRequests.id, assistantRequests.harnessId],
    }),
    foreignKey({
      name: 'assistant_reminders_effect_harness_fk',
      columns: [t.effectId, t.harnessId],
      foreignColumns: [assistantEffects.id, assistantEffects.harnessId],
    }),
    check(
      'assistant_reminders_status_known',
      oneOf(t.status, assistantReminderStatusSchema.options),
    ),
    check(
      'assistant_reminders_closed_when_done',
      sql`(${t.status} = 'set') = (${t.closedAt} IS NULL)`,
    ),
    check('assistant_reminders_text_length', sql`char_length(${t.text}) BETWEEN 1 AND 500`),
    uniqueIndex('assistant_reminders_effect_once').on(t.effectId),
    index('assistant_reminders_due').on(t.status, t.dueAt, t.id),
    index('assistant_reminders_harness').on(t.harnessId, t.status, t.dueAt),
  ],
);

const personalHarnessOf = (name: string, harnessId: AnyPgColumn, personId: AnyPgColumn) =>
  foreignKey({
    name,
    columns: [harnessId, personId],
    foreignColumns: [harnesses.id, harnesses.personId],
  });
const sha256Hex = (column: AnyPgColumn) => sql`${column} ~ '^[0-9a-f]{64}$'`;

export const assistantBindings = declareTable(
  'assistant_bindings',
  {
    harnessId: uuid('harness_id').notNull(),
    personId: uuid('person_id').notNull(),
    channel: text('channel').notNull(),
    address: text('address').notNull(),
    via: text('via').notNull(),
    boundAt: instant('bound_at').notNull(),
  },
  restrictedNever,
  (t) => [
    primaryKey({ name: 'assistant_bindings_pk', columns: [t.harnessId, t.channel] }),
    personalHarnessOf('assistant_bindings_personal_harness_fk', t.harnessId, t.personId),
    check('assistant_bindings_channel_known', oneOf(t.channel, assistantChannelSchema.options)),
    check('assistant_bindings_via_known', oneOf(t.via, assistantPairingViaSchema.options)),
    check('assistant_bindings_address_length', sql`char_length(${t.address}) BETWEEN 1 AND 254`),
    check(
      'assistant_bindings_zulip_address',
      sql`${t.channel} <> 'zulip_dm' OR ${t.address} ~ '^zulip:[1-9][0-9]{0,14}$'`,
    ),
    uniqueIndex('assistant_bindings_address_once').on(t.channel, t.address),
    index('assistant_bindings_person').on(t.personId, t.channel),
  ],
);

export const assistantPairingCodes = declareTable(
  'assistant_pairing_codes',
  {
    harnessId: uuid('harness_id').notNull(),
    personId: uuid('person_id').notNull(),
    channel: text('channel').notNull(),
    codeDigest: text('code_digest').notNull(),
    expiresAt: instant('expires_at').notNull(),
    attempts: integer('attempts').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  restrictedNever,
  (t) => [
    primaryKey({ name: 'assistant_pairing_codes_pk', columns: [t.harnessId, t.channel] }),
    personalHarnessOf('assistant_pairing_codes_personal_harness_fk', t.harnessId, t.personId),
    check(
      'assistant_pairing_codes_channel_known',
      oneOf(t.channel, assistantChannelSchema.options),
    ),
    check('assistant_pairing_codes_digest_shape', sha256Hex(t.codeDigest)),
    check('assistant_pairing_codes_attempts_bounded', sql`${t.attempts} BETWEEN 0 AND 5`),
  ],
);

export const assistantZulipBots = declareTable(
  'assistant_zulip_bots',
  {
    harnessId: uuid('harness_id').primaryKey(),
    personId: uuid('person_id').notNull(),
    botUserId: bigint('bot_user_id', { mode: 'number' }).notNull(),
    botEmail: text('bot_email').notNull(),
    fullName: text('full_name').notNull(),
    keyCipher: text('key_cipher').notNull(),
    keyCiphertext: text('key_ciphertext').notNull(),
    keyNonce: text('key_nonce').notNull(),
    keyWrapped: text('key_wrapped').notNull(),
    keyId: text('key_id').notNull(),
    webhookTokenDigest: text('webhook_token_digest').notNull(),
    status: text('status').notNull(),
    createdAt: instant('created_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  restrictedNever,
  (t) => [
    personalHarnessOf('assistant_zulip_bots_personal_harness_fk', t.harnessId, t.personId),
    check('assistant_zulip_bots_status_known', oneOf(t.status, ['active', 'deactivated'])),
    check('assistant_zulip_bots_token_digest_shape', sha256Hex(t.webhookTokenDigest)),
    check('assistant_zulip_bots_user_positive', sql`${t.botUserId} > 0`),
    check('assistant_zulip_bots_email_length', sql`char_length(${t.botEmail}) BETWEEN 3 AND 254`),
    check(
      'assistant_zulip_bots_full_name_length',
      sql`char_length(${t.fullName}) BETWEEN 1 AND 100`,
    ),
    uniqueIndex('assistant_zulip_bots_user_once').on(t.botUserId),
    uniqueIndex('assistant_zulip_bots_email_once').on(t.botEmail),
    index('assistant_zulip_bots_person').on(t.personId),
  ],
);

export const assistantZulipSends = declareTable(
  'assistant_zulip_sends',
  {
    effectId: uuid('effect_id').primaryKey(),
    harnessId: uuid('harness_id')
      .notNull()
      .references(() => harnesses.id),
    status: text('status').notNull(),
    zulipMessageId: bigint('zulip_message_id', { mode: 'number' }),
    claimedAt: instant('claimed_at').notNull(),
    sentAt: instant('sent_at'),
  },
  { classification: 'internal', offlineEligibility: 'never' },
  (t) => [
    check('assistant_zulip_sends_status_known', oneOf(t.status, ['sending', 'sent'])),
    check(
      'assistant_zulip_sends_sent_has_message',
      sql`(${t.status} = 'sent') = (${t.zulipMessageId} IS NOT NULL AND ${t.sentAt} IS NOT NULL)`,
    ),
  ],
);
