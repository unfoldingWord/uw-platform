import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { harnessItems } from './schema.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

type Db = OpenedDatabase['db'];
type Issue = {
  readonly repo: string | null;
  readonly number: number | null;
  readonly githubId: number | null;
};

const atText = '2026-10-01T09:00:00.000Z';
const harnessId = '00000000-0000-4000-8000-0000000000a1';
const stageId = '00000000-0000-4000-8000-0000000000a2';
const noIssue: Issue = { repo: null, number: null, githubId: null };
const issue: Issue = { repo: 'unfoldingWord/uw-platform', number: 42, githubId: 9100000001 };

function idOf(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function insertItem(db: Db, n: number, wrapped: Issue) {
  return db.execute(sql`INSERT INTO harness_items
    (id, harness_id, stage_id, title, issue_repo, issue_number, issue_github_id, created_at)
    VALUES (${idOf(n)}, ${harnessId}, ${stageId}, 'Item', ${wrapped.repo}, ${wrapped.number},
      ${wrapped.githubId}, ${atText}::timestamptz)`);
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
  return (await db.select().from(harnessItems).where(eq(harnessItems.harnessId, harnessId))).length;
}

async function seed(db: Db): Promise<void> {
  await db.execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at)
    VALUES (${harnessId}, 'software', 'software', '80-89', ${atText}::timestamptz)`);
  await db.execute(sql`INSERT INTO harness_stages
    (id, harness_id, key, title, position, bracket, agent_pickup, exit_gate)
    VALUES (${stageId}, ${harnessId}, 'package', 'Package', 1, 'build_package', 'none', 'checks')`);
}

function openDatabase(target: DatabaseTarget): () => Db {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
    await seed(opened.db);
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

function issueRules(db: () => Db): void {
  it('refuses a second item wrapping the same issue by harness_items_issue_once', async () => {
    await insertItem(db(), 0xb1, issue);
    const moved = { ...issue, repo: 'unfoldingWord/elsewhere', number: 7 };
    expect(await refusal(insertItem(db(), 0xb2, moved))).toEqual({
      code: '23505',
      constraint: 'harness_items_issue_once',
    });
  });

  it.each([
    ['a repository but no number', { ...issue, number: null }],
    ['a number but no GitHub id', { ...issue, githubId: null }],
    ['a GitHub id alone', { ...noIssue, githubId: 9100000002 }],
  ])('refuses an issue with %s by harness_items_issue_whole', async (_case, partial) => {
    expect(await refusal(insertItem(db(), 0xc1, partial))).toEqual({
      code: '23514',
      constraint: 'harness_items_issue_whole',
    });
  });

  it('accepts any number of items that wrap no issue', async () => {
    const before = await countOf(db());
    await insertItem(db(), 0xd1, noIssue);
    await insertItem(db(), 0xd2, noIssue);
    expect(await countOf(db())).toBe(before + 2);
  });
}

describe('GH-3 an issue becomes at most one item', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => issueRules(openDatabase(target)),
  );
});
