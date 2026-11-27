import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnyDatabase } from './any-database.ts';
import { declarationOf } from './declarations.ts';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import * as schema from './schema.ts';
import { seedPerson } from './test-seed.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

const uid = (n: number) =>
  `00000000-0000-4000-8000-${(0x79a000 + n).toString(16).padStart(12, '0')}`;

const person = uid(1);
const other = uid(2);
const third = uid(3);
const personal = uid(11);
const otherPersonal = uid(12);
const thirdPersonal = uid(13);
const atText = '2026-11-27T09:00:00.000Z';

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

async function personalHarness(db: AnyDatabase, id: string, personId: string) {
  await db.execute(sql`INSERT INTO harnesses (id, key, title, template, jd_area, created_at, person_id)
    VALUES (${id}, ${`assistant-${personId}`}, 'Assistant', 'assistant', '10-19',
      ${atText}::timestamptz, ${personId})`);
}

type AccountRow = {
  readonly harnessId: string;
  readonly personId: string;
  readonly name?: string;
  readonly jdId?: string | null;
  readonly status?: string;
  readonly disabledAt?: string | null;
  readonly deletedAt?: string | null;
};

function addAccount(db: AnyDatabase, row: AccountRow) {
  const jdId = row.jdId === undefined ? '10.51' : row.jdId;
  return db.execute(sql`INSERT INTO assistant_accounts
      (harness_id, person_id, name, jd_id, status, disabled_at, deleted_at, version,
       created_at, updated_at)
    VALUES (${row.harnessId}, ${row.personId}, ${row.name ?? 'barnabas'}, ${jdId},
      ${row.status ?? 'enabled'}, ${row.disabledAt ?? null}::timestamptz,
      ${row.deletedAt ?? null}::timestamptz, 1, ${atText}::timestamptz, ${atText}::timestamptz)`);
}

function addProvisioning(db: AnyDatabase, harnessId: string, personId: string, step: string) {
  return db.execute(sql`INSERT INTO assistant_provisioning
      (harness_id, person_id, account_version, step, status, failure, attempts, next_at,
       updated_at)
    VALUES (${harnessId}, ${personId}, 1, ${step}, 'working', NULL, 0, ${atText}::timestamptz,
      ${atText}::timestamptz)`);
}

function openDatabase(target: DatabaseTarget): () => AnyDatabase {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
    await seedPerson(opened.db, { id: person, email: 'account-person@example.org' });
    await seedPerson(opened.db, { id: other, email: 'account-other@example.org' });
    await seedPerson(opened.db, { id: third, email: 'account-third@example.org' });
    await personalHarness(opened.db, personal, person);
    await personalHarness(opened.db, otherPersonal, other);
    await personalHarness(opened.db, thirdPersonal, third);
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

function shapeRules(db: () => AnyDatabase): void {
  it('refuses a JD id outside 10.51 upward and a name a mailbox could not have', async () => {
    expect(
      await refusal(addAccount(db(), { harnessId: personal, personId: person, jdId: '10.50' })),
    ).toEqual({ code: '23514', constraint: 'assistant_accounts_jd_id_range' });
    expect(
      await refusal(addAccount(db(), { harnessId: personal, personId: person, name: 'Bar Nabas' })),
    ).toEqual({ code: '23514', constraint: 'assistant_accounts_name_shape' });
    expect(await refusal(addAccount(db(), { harnessId: personal, personId: other }))).toEqual({
      code: '23503',
      constraint: 'assistant_accounts_personal_harness_fk',
    });
  });

  it('holds a JD id exactly while not deleted, and a time for each turn off', async () => {
    expect(
      await refusal(addAccount(db(), { harnessId: personal, personId: person, jdId: null })),
    ).toEqual({ code: '23514', constraint: 'assistant_accounts_jd_id_until_deleted' });
    expect(
      await refusal(
        addAccount(db(), { harnessId: personal, personId: person, status: 'disabled' }),
      ),
    ).toEqual({ code: '23514', constraint: 'assistant_accounts_disabled_has_time' });
    expect(
      await refusal(
        addAccount(db(), {
          harnessId: personal,
          personId: person,
          status: 'deleted',
          jdId: null,
          disabledAt: atText,
        }),
      ),
    ).toEqual({ code: '23514', constraint: 'assistant_accounts_deleted_has_time' });
  });
}

function uniquenessRules(db: () => AnyDatabase): void {
  it('gives one JD id and one name to one live assistant, and frees both on deletion', async () => {
    await addAccount(db(), { harnessId: personal, personId: person });
    expect(
      await refusal(addAccount(db(), { harnessId: otherPersonal, personId: other, name: 'silas' })),
    ).toEqual({ code: '23505', constraint: 'assistant_accounts_jd_id_once' });
    expect(
      await refusal(addAccount(db(), { harnessId: otherPersonal, personId: other, jdId: '10.52' })),
    ).toEqual({ code: '23505', constraint: 'assistant_accounts_name_once' });
    await addAccount(db(), {
      harnessId: otherPersonal,
      personId: other,
      jdId: null,
      status: 'deleted',
      disabledAt: atText,
      deletedAt: atText,
    });
  });

  it('keeps provisioning progress to a known step on a personal harness', async () => {
    expect(await refusal(addProvisioning(db(), personal, person, 'make_mailbox'))).toEqual({
      code: '23514',
      constraint: 'assistant_provisioning_step_known',
    });
    expect(await refusal(addProvisioning(db(), thirdPersonal, other, 'workspace_user'))).toEqual({
      code: '23503',
      constraint: 'assistant_provisioning_personal_harness_fk',
    });
    await addProvisioning(db(), personal, person, 'workspace_user');
  });
}

describe('PA-14 the assistant account and provisioning tables', () => {
  it('declares both internal and never offline', () => {
    for (const table of [schema.assistantAccounts, schema.assistantProvisioning]) {
      expect(declarationOf(table)).toEqual({
        classification: 'internal',
        offlineEligibility: 'never',
      });
    }
  });

  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => {
      const db = openDatabase(target);
      shapeRules(db);
      uniquenessRules(db);
    },
  );
});
