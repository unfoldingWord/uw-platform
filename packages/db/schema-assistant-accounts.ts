import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  ASSISTANT_JD_ID_PATTERN,
  ASSISTANT_NAME_PATTERN,
  assistantAccountStatusSchema,
  assistantProvisioningFailureSchema,
  assistantProvisioningStatusSchema,
  assistantProvisioningStepSchema,
} from '@uw/contracts';
import { matches, oneOf } from './checks.ts';
import { instant } from './columns.ts';
import { declareTable } from './declarations.ts';
import { harnesses } from './schema-harnesses.ts';

const internalNever = { classification: 'internal', offlineEligibility: 'never' } as const;

const personalHarnessOf = (name: string, harnessId: AnyPgColumn, personId: AnyPgColumn) =>
  foreignKey({
    name,
    columns: [harnessId, personId],
    foreignColumns: [harnesses.id, harnesses.personId],
  });

export const assistantAccounts = declareTable(
  'assistant_accounts',
  {
    harnessId: uuid('harness_id').primaryKey(),
    personId: uuid('person_id').notNull(),
    name: text('name').notNull(),
    jdId: text('jd_id'),
    status: text('status').notNull(),
    disabledAt: instant('disabled_at'),
    deletedAt: instant('deleted_at'),
    version: integer('version').notNull(),
    createdAt: instant('created_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  internalNever,
  (t) => [
    personalHarnessOf('assistant_accounts_personal_harness_fk', t.harnessId, t.personId),
    check('assistant_accounts_status_known', oneOf(t.status, assistantAccountStatusSchema.options)),
    check(
      'assistant_accounts_name_shape',
      sql`${matches(t.name, ASSISTANT_NAME_PATTERN)} AND position('..' in ${t.name}) = 0`,
    ),
    check('assistant_accounts_jd_id_range', matches(t.jdId, ASSISTANT_JD_ID_PATTERN)),
    check(
      'assistant_accounts_jd_id_until_deleted',
      sql`(${t.status} = 'deleted') = (${t.jdId} IS NULL)`,
    ),
    check(
      'assistant_accounts_disabled_has_time',
      sql`(${t.status} = 'enabled') = (${t.disabledAt} IS NULL)`,
    ),
    check(
      'assistant_accounts_deleted_has_time',
      sql`(${t.status} = 'deleted') = (${t.deletedAt} IS NOT NULL)`,
    ),
    check('assistant_accounts_version_positive', sql`${t.version} >= 1`),
    uniqueIndex('assistant_accounts_jd_id_once')
      .on(t.jdId)
      .where(sql`${t.jdId} IS NOT NULL`),
    uniqueIndex('assistant_accounts_name_once')
      .on(t.name)
      .where(sql`${t.status} <> 'deleted'`),
    uniqueIndex('assistant_accounts_person_once').on(t.personId),
    index('assistant_accounts_disabled').on(t.status, t.disabledAt),
  ],
);

export const assistantProvisioning = declareTable(
  'assistant_provisioning',
  {
    harnessId: uuid('harness_id').primaryKey(),
    personId: uuid('person_id').notNull(),
    accountVersion: integer('account_version').notNull(),
    step: text('step').notNull(),
    status: text('status').notNull(),
    failure: text('failure'),
    attempts: integer('attempts').notNull(),
    nextAt: instant('next_at').notNull(),
    updatedAt: instant('updated_at').notNull(),
  },
  internalNever,
  (t) => [
    personalHarnessOf('assistant_provisioning_personal_harness_fk', t.harnessId, t.personId),
    check(
      'assistant_provisioning_step_known',
      oneOf(t.step, assistantProvisioningStepSchema.options),
    ),
    check(
      'assistant_provisioning_status_known',
      oneOf(t.status, assistantProvisioningStatusSchema.options),
    ),
    check(
      'assistant_provisioning_failure_known',
      sql`${t.failure} IS NULL OR ${oneOf(t.failure, assistantProvisioningFailureSchema.options)}`,
    ),
    check(
      'assistant_provisioning_failed_has_reason',
      sql`(${t.status} = 'failed') = (${t.failure} IS NOT NULL)`,
    ),
    check('assistant_provisioning_attempts_bounded', sql`${t.attempts} BETWEEN 0 AND 100000`),
    index('assistant_provisioning_next').on(t.nextAt),
  ],
);
