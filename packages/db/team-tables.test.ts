import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnyDatabase } from './any-database.ts';
import { declarationOf } from './declarations.ts';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import * as schema from './schema.ts';
import { seedPage, seedPerson } from './test-seed.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

const ada = '00000000-0000-4000-8000-000000200b01';
const sam = '00000000-0000-4000-8000-000000200b02';
const program = '00000000-0000-4000-8000-000000200b11';
const portfolio = '00000000-0000-4000-8000-000000200b12';
const at = '2026-11-26T09:00:00.000Z';
const steward = `human:${ada}`;

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

type Row = Readonly<Record<string, string | number | null>>;

function pick(row: Row, key: string, fallback: string | number | null) {
  return key in row ? (row[key] ?? null) : fallback;
}

function addAllocation(db: AnyDatabase, row: Row = {}) {
  return db.execute(sql`INSERT INTO staff_allocations
      (person_id, program_page_id, portfolio_page_id, percent, updated_by, updated_at)
    VALUES (${pick(row, 'person', ada)}, ${pick(row, 'program', program)},
      ${pick(row, 'portfolio', null)}, ${pick(row, 'percent', 40)},
      ${pick(row, 'updatedBy', steward)}, ${at}::timestamptz)`);
}

function addCommitment(db: AnyDatabase, row: Row = {}) {
  return db.execute(sql`INSERT INTO person_commitments
      (from_person_id, to_person_id, to_text, updated_by, updated_at)
    VALUES (${pick(row, 'from', ada)}, ${pick(row, 'toPerson', sam)}, ${pick(row, 'toText', null)},
      ${pick(row, 'updatedBy', steward)}, ${at}::timestamptz)`);
}

function openDatabase(target: DatabaseTarget): () => AnyDatabase {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
    await seedPerson(opened.db, { id: ada, email: 'ada.example@example.org' });
    await seedPerson(opened.db, { id: sam, email: 'sam.sample@example.org' });
    const page = { status: 'active' as const, jdArea: '00-09', bodyMd: '', frontmatter: {} };
    await seedPage(opened.db, { ...page, id: program, type: 'program', slug: 'p', title: 'P' });
    await seedPage(opened.db, { ...page, id: portfolio, type: 'portfolio', slug: 'q', title: 'Q' });
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

const allocationRefusals: readonly (readonly [string, Row, string])[] = [
  ['both a program and a portfolio', { portfolio }, 'staff_allocations_one_target'],
  ['neither a program nor a portfolio', { program: null }, 'staff_allocations_one_target'],
  ['a percent above 100', { percent: 101 }, 'staff_allocations_percent_range'],
  ['a negative percent', { percent: -1 }, 'staff_allocations_percent_range'],
  [
    'a writer that is not an identity',
    { updatedBy: 'ada' },
    'staff_allocations_updated_by_is_identity',
  ],
];

const commitmentRefusals: readonly (readonly [string, Row, string])[] = [
  ['both a person and a text', { toText: 'Sam' }, 'person_commitments_one_target'],
  ['neither a person nor a text', { toPerson: null }, 'person_commitments_one_target'],
  ['a blank text', { toPerson: null, toText: '   ' }, 'person_commitments_to_text_bounded'],
  ['a commitment to oneself', { toPerson: ada }, 'person_commitments_not_to_self'],
];

function rowRules(db: () => AnyDatabase): void {
  it('#200 records an allocation to a program, one to a portfolio with no percent, and commitments by id and by text', async () => {
    await addAllocation(db());
    await addAllocation(db(), { program: null, portfolio, percent: null });
    await addCommitment(db());
    await addCommitment(db(), { toPerson: null, toText: 'Sam' });
  });

  it('#200 keeps one allocation per person per program and one commitment per person pair', async () => {
    expect(await refusal(addAllocation(db()))).toEqual({
      code: '23505',
      constraint: 'staff_allocations_one_per_program',
    });
    expect(await refusal(addCommitment(db()))).toEqual({
      code: '23505',
      constraint: 'person_commitments_one_per_pair',
    });
  });

  it.each(allocationRefusals)(
    '#200 refuses an allocation with %s',
    async (_n, change, constraint) => {
      const row = { person: sam, ...change };
      expect(await refusal(addAllocation(db(), row))).toEqual({ code: '23514', constraint });
    },
  );

  it.each(commitmentRefusals)(
    '#200 refuses a commitment with %s',
    async (_n, change, constraint) => {
      expect(await refusal(addCommitment(db(), change))).toEqual({ code: '23514', constraint });
    },
  );
}

describe('#200 the staff allocation and commitment tables', () => {
  it('#200 declares both internal and readable offline from cache', () => {
    const declared = [schema.staffAllocations, schema.personCommitments];
    expect(declared.map(declarationOf)).toEqual(
      declared.map(() => ({ classification: 'internal', offlineEligibility: 'cache_readonly' })),
    );
  });

  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => rowRules(openDatabase(target)),
  );
});
