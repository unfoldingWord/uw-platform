import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { harnesses } from './schema.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

type Db = OpenedDatabase['db'];

const atText = '2026-10-01T09:00:00.000Z';

function idOf(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function insertHarness(db: Db, n: number, repository: string | null) {
  return db.execute(sql`INSERT INTO harnesses (id, key, template, jd_area, repository, created_at)
    VALUES (${idOf(n)}, ${`repo-${n}`}, 'software', '80-89', ${repository},
      ${atText}::timestamptz)`);
}

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

async function countOf(db: Db): Promise<number> {
  return (await db.select().from(harnesses)).length;
}

function openDatabase(target: DatabaseTarget): () => Db {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

const malformed = [
  'no-slash',
  'unfoldingWord/uw platform',
  'a/b/c',
  '/uw-platform',
  'unfoldingWord/',
  'unfoldingWord/.',
  'unfoldingWord/..',
  '-x/y',
  'x-/y',
  `${'a'.repeat(40)}/y`,
  `x/${'a'.repeat(101)}`,
  'unfolding_word/uw-platform',
  'unfoldingWord/\u212Aey',
];

function repositoryRules(db: () => Db): void {
  it.each(malformed)(
    'refuses the malformed repository %j by harnesses_repository_form',
    async (repository) => {
      expect(await refusal(insertHarness(db(), 0xa1, repository))).toEqual({
        code: '23514',
        constraint: 'harnesses_repository_form',
      });
    },
  );

  it('refuses two harnesses whose repositories differ only in case by harnesses_repository_once', async () => {
    await insertHarness(db(), 0xb1, 'unfoldingWord/uw-platform');
    expect(await refusal(insertHarness(db(), 0xb2, 'UnfoldingWord/UW-Platform'))).toEqual({
      code: '23505',
      constraint: 'harnesses_repository_once',
    });
  });

  it('accepts the longest owner and name GitHub allows and a dot-led name', async () => {
    const before = await countOf(db());
    await insertHarness(db(), 0xd1, `${'a'.repeat(39)}/${'b'.repeat(100)}`);
    await insertHarness(db(), 0xd2, 'unfoldingWord/.github');
    expect(await countOf(db())).toBe(before + 2);
  });

  it('accepts any number of harnesses that name no repository', async () => {
    const before = await countOf(db());
    await insertHarness(db(), 0xc1, null);
    await insertHarness(db(), 0xc2, null);
    expect(await countOf(db())).toBe(before + 2);
  });
}

describe('the harnesses repository column (the GH-6 SECURITY carry)', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => repositoryRules(openDatabase(target)),
  );
});
