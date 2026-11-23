import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { connectorSchema } from '@uw/contracts';
import {
  credentialAccessActions,
  credentialAccessOutcomes,
  credentialCiphers,
  credentialGrantCapabilities,
  credentialKinds,
  credentialRefusals,
} from '@uw/core/credentials';
import { IDENTITY_PATTERN, JD_AREA_PATTERN, matches, oneOf } from './checks.ts';
import { instant } from './columns.ts';
import { declareTable } from './declarations.ts';
import { harnesses } from './schema-harnesses.ts';
import { people } from './schema-platform.ts';

const sensitiveNever = { classification: 'sensitive', offlineEligibility: 'never' } as const;
const restrictedNever = { classification: 'restricted', offlineEligibility: 'never' } as const;

const JD_REF_PATTERN = '^[0-9]{2}(\\.[0-9]{2})?$';
const BASE64_PATTERN = '^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$';
const NONCE_BASE64_LENGTH = 16;

const effectConnectors = connectorSchema.exclude(['none']).options;

export const credentials = declareTable(
  'credentials',
  {
    id: uuid('id').primaryKey(),
    jdArea: text('jd_area').notNull(),
    jdRef: text('jd_ref'),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => people.id),
    rotateBy: date('rotate_by', { mode: 'string' }),
    expiresAt: instant('expires_at'),
    revokedAt: instant('revoked_at'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => people.id),
    createdAt: instant('created_at').notNull(),
  },
  sensitiveNever,
  (t) => [
    check('credentials_area_is_jd', matches(t.jdArea, JD_AREA_PATTERN)),
    check(
      'credentials_ref_inside_area',
      sql`${t.jdRef} IS NULL OR (${matches(t.jdRef, JD_REF_PATTERN)} AND left(${t.jdRef}, 1) = left(${t.jdArea}, 1))`,
    ),
    check('credentials_kind_known', oneOf(t.kind, credentialKinds)),
    check(
      'credentials_name_trimmed',
      sql`${t.name} = btrim(${t.name}) AND length(${t.name}) BETWEEN 1 AND 120`,
    ),
    unique('credentials_name_per_area').on(t.jdArea, t.name),
  ],
);

export const credentialVersions = declareTable(
  'credential_versions',
  {
    id: uuid('id').primaryKey(),
    credentialId: uuid('credential_id')
      .notNull()
      .references(() => credentials.id),
    version: integer('version').notNull(),
    cipher: text('cipher').notNull(),
    ciphertext: text('ciphertext').notNull(),
    nonce: text('nonce').notNull(),
    wrappedKey: text('wrapped_key').notNull(),
    keyId: text('key_id').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => people.id),
    createdAt: instant('created_at').notNull(),
  },
  sensitiveNever,
  (t) => [
    check('credential_versions_version_positive', sql`${t.version} >= 1`),
    check('credential_versions_cipher_known', oneOf(t.cipher, credentialCiphers)),
    check(
      'credential_versions_nonce_length',
      sql`length(${t.nonce}) = ${sql.raw(String(NONCE_BASE64_LENGTH))} AND ${matches(t.nonce, BASE64_PATTERN)}`,
    ),
    check(
      'credential_versions_sealed',
      sql`length(${t.ciphertext}) > 0 AND ${matches(t.ciphertext, BASE64_PATTERN)} AND length(${t.wrappedKey}) > 0 AND ${matches(t.wrappedKey, BASE64_PATTERN)} AND length(${t.keyId}) > 0`,
    ),
    unique('credential_versions_once').on(t.credentialId, t.version),
  ],
);

export const credentialGrants = declareTable(
  'credential_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    credentialId: uuid('credential_id')
      .notNull()
      .references(() => credentials.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    capability: text('capability').notNull(),
    grantedBy: uuid('granted_by')
      .notNull()
      .references(() => people.id),
    grantedAt: instant('granted_at').notNull(),
    expiresAt: instant('expires_at').notNull(),
    revokedAt: instant('revoked_at'),
    secondRequired: boolean('second_required').notNull().default(false),
    secondBy: uuid('second_by').references(() => people.id),
    secondAt: instant('second_at'),
  },
  restrictedNever,
  (t) => [
    check('credential_grants_capability_known', oneOf(t.capability, credentialGrantCapabilities)),
    check('credential_grants_expires_after_grant', sql`${t.expiresAt} > ${t.grantedAt}`),
    check(
      'credential_grants_second_is_another_person',
      sql`(${t.secondBy} IS NULL AND ${t.secondAt} IS NULL) OR (${t.secondRequired} AND ${t.secondBy} IS NOT NULL AND ${t.secondAt} IS NOT NULL AND ${t.secondBy} <> ${t.grantedBy})`,
    ),
    index('credential_grants_credential').on(t.credentialId, t.personId),
  ],
);

export const credentialBindings = declareTable(
  'credential_bindings',
  {
    credentialId: uuid('credential_id')
      .notNull()
      .references(() => credentials.id),
    harnessId: uuid('harness_id')
      .notNull()
      .references(() => harnesses.id),
    connectorKey: text('connector_key').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => people.id),
    createdAt: instant('created_at').notNull(),
  },
  restrictedNever,
  (t) => [
    primaryKey({
      name: 'credential_bindings_once',
      columns: [t.credentialId, t.harnessId, t.connectorKey],
    }),
    check('credential_bindings_connector_known', oneOf(t.connectorKey, effectConnectors)),
  ],
);

export const credentialAccessLog = declareTable(
  'credential_access_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    position: bigint('position', { mode: 'number' }).notNull().generatedAlwaysAsIdentity(),
    credentialId: uuid('credential_id')
      .notNull()
      .references(() => credentials.id),
    versionId: uuid('version_id').references(() => credentialVersions.id),
    jdArea: text('jd_area').notNull(),
    action: text('action').notNull(),
    outcome: text('outcome').notNull(),
    reason: text('reason'),
    actor: text('actor').notNull(),
    personId: uuid('person_id').references(() => people.id),
    harnessId: uuid('harness_id'),
    connectorKey: text('connector_key'),
    runId: uuid('run_id'),
    traceId: uuid('trace_id').notNull(),
    at: instant('at').notNull(),
  },
  sensitiveNever,
  (t) => [
    check('credential_access_log_area_is_jd', matches(t.jdArea, JD_AREA_PATTERN)),
    check('credential_access_log_action_known', oneOf(t.action, credentialAccessActions)),
    check('credential_access_log_outcome_known', oneOf(t.outcome, credentialAccessOutcomes)),
    check(
      'credential_access_log_reason_matches',
      sql`(${t.outcome} = 'done' AND ${t.reason} IS NULL) OR (${t.outcome} = 'refused' AND ${t.reason} IS NOT NULL AND ${oneOf(t.reason, credentialRefusals)})`,
    ),
    check('credential_access_log_actor_is_identity', matches(t.actor, IDENTITY_PATTERN)),
    index('credential_access_log_credential').on(t.credentialId, t.position),
  ],
);
