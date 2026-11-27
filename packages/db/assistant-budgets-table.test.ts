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
  `00000000-0000-4000-8000-${(0x77b000 + n).toString(16).padStart(12, '0')}`;

const person = uid(1);
const other = uid(2);
const admin = uid(3);
const personal = uid(4);
const otherPersonal = uid(5);
const atText = '2026-11-20T09:00:00.000Z';

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

type BudgetRow = {
  readonly harnessId: string;
  readonly personId: string;
  readonly monthlyMinor: number;
  readonly setBy?: string;
};

function addBudget(db: AnyDatabase, row: BudgetRow) {
  return db.execute(sql`INSERT INTO assistant_budgets
      (harness_id, person_id, monthly_minor, set_by, set_at)
    VALUES (${row.harnessId}, ${row.personId}, ${row.monthlyMinor}, ${row.setBy ?? admin},
      ${atText}::timestamptz)`);
}

function openDatabase(target: DatabaseTarget): () => AnyDatabase {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
    await seedPerson(opened.db, { id: person, email: 'budget-person@example.org' });
    await seedPerson(opened.db, { id: other, email: 'budget-other@example.org' });
    await seedPerson(opened.db, { id: admin, email: 'budget-admin@example.org' });
    await personalHarness(opened.db, personal, person);
    await personalHarness(opened.db, otherPersonal, other);
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

function budgetRules(db: () => AnyDatabase): void {
  it('keeps one budget per assistant', async () => {
    await addBudget(db(), { harnessId: personal, personId: person, monthlyMinor: 5000 });
    expect(
      await refusal(addBudget(db(), { harnessId: personal, personId: person, monthlyMinor: 10 })),
    ).toEqual({ code: '23505', constraint: 'assistant_budgets_pkey' });
  });

  it('refuses a negative budget and one over ten thousand dollars', async () => {
    const row = { harnessId: otherPersonal, personId: other };
    expect(await refusal(addBudget(db(), { ...row, monthlyMinor: -1 }))).toEqual({
      code: '23514',
      constraint: 'assistant_budgets_monthly_bounded',
    });
    expect(await refusal(addBudget(db(), { ...row, monthlyMinor: 1_000_001 }))).toEqual({
      code: '23514',
      constraint: 'assistant_budgets_monthly_bounded',
    });
  });

  it("refuses a budget whose person is not the harness's person", async () => {
    const crossed = { harnessId: otherPersonal, personId: person, monthlyMinor: 100 };
    expect(await refusal(addBudget(db(), crossed))).toEqual({
      code: '23503',
      constraint: 'assistant_budgets_personal_harness_fk',
    });
  });

  it('refuses a budget set by nobody the platform knows', async () => {
    const unknown = { harnessId: otherPersonal, personId: other, monthlyMinor: 100, setBy: uid(9) };
    expect(await refusal(addBudget(db(), unknown))).toEqual({
      code: '23503',
      constraint: 'assistant_budgets_set_by_fk',
    });
  });
}

describe('PA-16 the assistant_budgets table', () => {
  it('declares the table internal and never offline', () => {
    expect(declarationOf(schema.assistantBudgets)).toEqual({
      classification: 'internal',
      offlineEligibility: 'never',
    });
  });

  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => {
      const db = openDatabase(target);
      budgetRules(db);
    },
  );
});
