import { and, asc, eq, like } from 'drizzle-orm';
import { pgSchema, text } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { declarationOf, tableEntries } from './declarations.ts';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import * as schema from './schema.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

type Db = OpenedDatabase['db'];

const readModelTables = [
  'gh_check_runs',
  'gh_issues',
  'gh_milestones',
  'gh_prs',
  'gh_repos',
  'gh_reviews',
];
const readModelExports = [
  schema.ghCheckRuns,
  schema.ghIssues,
  schema.ghMilestones,
  schema.ghPrs,
  schema.ghRepos,
  schema.ghReviews,
];
const freshAt = new Date('2026-10-02T09:00:00.000Z');
const laterAt = new Date('2026-10-02T10:00:00.000Z');
const repoId = 9100000001;
const sha40 = 'abcdef0123456789abcdef0123456789abcdef01';
const sha64 = 'abcdef0123456789'.repeat(4);
const uppercaseSha = 'ABCDEF0123'.repeat(4);

const information = pgSchema('information_schema');
const constraints = information.table('table_constraints', {
  constraintName: text('constraint_name'),
  tableName: text('table_name'),
  constraintType: text('constraint_type'),
});
const keyUsage = information.table('key_column_usage', {
  constraintName: text('constraint_name'),
  tableName: text('table_name'),
  columnName: text('column_name'),
});
const columns = information.table('columns', {
  tableName: text('table_name'),
  columnName: text('column_name'),
  isNullable: text('is_nullable'),
  dataType: text('data_type'),
});
const indexes = pgSchema('pg_catalog').table('pg_indexes', {
  indexname: text('indexname'),
  indexdef: text('indexdef'),
});

type PrRow = typeof schema.ghPrs.$inferInsert;

function prRow(githubId: number, change: Partial<PrRow> = {}): PrRow {
  return {
    githubId,
    repoId,
    number: githubId - 9100000000,
    title: 'Add the read model',
    state: 'open',
    draft: false,
    headSha: sha40,
    headRef: 'harness/item',
    baseRef: 'main',
    baseSha: sha40,
    githubUpdatedAt: freshAt,
    freshAt,
    ...change,
  };
}

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

function insertRepo(db: Db, githubId: number, fullName: string) {
  return db.insert(schema.ghRepos).values({
    githubId,
    fullName,
    defaultBranch: 'main',
    private: false,
    freshAt,
  });
}

type CheckRunRow = typeof schema.ghCheckRuns.$inferInsert;
type ReviewRow = typeof schema.ghReviews.$inferInsert;

function insertCheckRun(db: Db, githubId: number, change: Partial<CheckRunRow> = {}) {
  return db.insert(schema.ghCheckRuns).values({
    githubId,
    repoId,
    headSha: sha40,
    name: 'test',
    status: 'completed',
    conclusion: null,
    freshAt,
    ...change,
  });
}

function insertReview(db: Db, githubId: number, prId: number, change: Partial<ReviewRow> = {}) {
  return db.insert(schema.ghReviews).values({
    githubId,
    repoId,
    prId,
    reviewerLogin: 'zz-reviewer',
    commitId: sha40,
    state: 'approved',
    freshAt,
    ...change,
  });
}

function insertIssue(db: Db, githubId: number, state: string) {
  return db.insert(schema.ghIssues).values({
    githubId,
    repoId,
    number: githubId - 9100000000,
    title: 'Index the deliveries',
    state,
    githubUpdatedAt: freshAt,
    freshAt,
  });
}

function insertMilestone(db: Db, githubId: number, state: string) {
  return db.insert(schema.ghMilestones).values({
    githubId,
    repoId,
    number: githubId - 9100000000,
    title: 'Step 5',
    state,
    githubUpdatedAt: freshAt,
    freshAt,
  });
}

async function reviewOnNewPr(db: Db, change: Partial<ReviewRow>) {
  await db.insert(schema.ghPrs).values(prRow(9100000205));
  return insertReview(db, 9100000403, 9100000205, change);
}

function openDatabase(target: DatabaseTarget): () => Db {
  let opened: OpenedDatabase | undefined;
  const db = () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
  beforeAll(async () => {
    opened = await target.open();
    await insertRepo(opened.db, repoId, 'unfoldingWord/uw-platform');
  }, 60_000);
  afterAll(() => opened?.close());
  return db;
}

async function keyColumns(db: Db) {
  const rows = await db
    .select({ table: keyUsage.tableName, column: keyUsage.columnName })
    .from(constraints)
    .innerJoin(
      keyUsage,
      and(
        eq(keyUsage.constraintName, constraints.constraintName),
        eq(keyUsage.tableName, constraints.tableName),
      ),
    )
    .where(
      and(eq(constraints.constraintType, 'PRIMARY KEY'), like(constraints.tableName, 'gh\\_%')),
    )
    .orderBy(asc(keyUsage.tableName));
  return rows.map((row) => `${row.table}.${row.column}`);
}

async function freshness(db: Db) {
  const rows = await db
    .select({ table: columns.tableName, nullable: columns.isNullable, type: columns.dataType })
    .from(columns)
    .where(and(eq(columns.columnName, 'fresh_at'), like(columns.tableName, 'gh\\_%')))
    .orderBy(asc(columns.tableName));
  return rows.map((row) => `${row.table} ${row.nullable} ${row.type}`);
}

function readModelRules(db: () => Db): void {
  it('declares each of the six tables internal and readable offline from cache', () => {
    const entries = tableEntries(schema).filter((entry) => entry.table.startsWith('gh_'));
    expect(entries.map((entry) => entry.table).sort()).toEqual(readModelTables);
    expect(readModelExports.map((table) => declarationOf(table))).toEqual(
      readModelExports.map(() => ({
        classification: 'internal',
        offlineEligibility: 'cache_readonly',
      })),
    );
  });

  it('keys each table on its GitHub id and gives each a freshness timestamp', async () => {
    expect(await keyColumns(db())).toEqual(readModelTables.map((table) => `${table}.github_id`));
    expect(await freshness(db())).toEqual(
      readModelTables.map((table) => `${table} NO timestamp with time zone`),
    );
  });

  it('upserts a redelivered PR into the one row its GitHub id names', async () => {
    const upsert = (row: PrRow) =>
      db()
        .insert(schema.ghPrs)
        .values(row)
        .onConflictDoUpdate({
          target: schema.ghPrs.githubId,
          set: { title: row.title, headSha: row.headSha, freshAt: row.freshAt },
        });
    await upsert(prRow(9100000101));
    await upsert(prRow(9100000101, { title: 'Second title', headSha: sha64, freshAt: laterAt }));
    const rows = await db()
      .select({ title: schema.ghPrs.title, head: schema.ghPrs.headSha, at: schema.ghPrs.freshAt })
      .from(schema.ghPrs)
      .where(eq(schema.ghPrs.githubId, 9100000101));
    expect(rows).toEqual([{ title: 'Second title', head: sha64, at: laterAt }]);
  });
}

const headRefusals: [string, string][] = [
  ['an abbreviated head', 'abc123'],
  ['an uppercase head', uppercaseSha],
];

function factRules(db: () => Db): void {
  it.each(headRefusals)('refuses %s on gh_prs', async (_label, headSha) => {
    expect(await refusal(db().insert(schema.ghPrs).values(prRow(9100000201, { headSha })))).toEqual(
      { code: '23514', constraint: 'gh_prs_head_sha_form' },
    );
  });

  it('accepts a 40- and a 64-character lowercase head', async () => {
    await db()
      .insert(schema.ghPrs)
      .values(prRow(9100000202, { headSha: sha40 }));
    await db()
      .insert(schema.ghPrs)
      .values(prRow(9100000203, { headSha: sha64 }));
  });

  it('refuses a check conclusion outside the closed set', async () => {
    expect(await refusal(insertCheckRun(db(), 9100000301, { conclusion: 'green' }))).toEqual({
      code: '23514',
      constraint: 'gh_check_runs_conclusion_known',
    });
    await insertCheckRun(db(), 9100000302);
  });

  it('refuses a review state outside the closed set', async () => {
    await db().insert(schema.ghPrs).values(prRow(9100000204));
    expect(await refusal(insertReview(db(), 9100000401, 9100000204, { state: 'pending' }))).toEqual(
      {
        code: '23514',
        constraint: 'gh_reviews_state_known',
      },
    );
    await insertReview(db(), 9100000402, 9100000204);
  });

  it('refuses a repository name with no owner', async () => {
    expect(await refusal(insertRepo(db(), 9100000002, 'no-slash'))).toEqual({
      code: '23514',
      constraint: 'gh_repos_full_name_form',
    });
  });
}

const columnRefusals: [string, (db: Db) => PromiseLike<unknown>, string][] = [
  [
    'a PR state outside the closed set',
    (db) => db.insert(schema.ghPrs).values(prRow(9100000701, { state: 'draft' })),
    'gh_prs_state_known',
  ],
  [
    'an abbreviated head for a PR file list',
    (db) => db.insert(schema.ghPrs).values(prRow(9100000702, { filesHead: 'abc123' })),
    'gh_prs_files_head_form',
  ],
  [
    'an abbreviated base for a PR',
    (db) => db.insert(schema.ghPrs).values(prRow(9100000703, { baseSha: 'abc123' })),
    'gh_prs_base_sha_form',
  ],
  [
    'an abbreviated base for a PR file list',
    (db) => db.insert(schema.ghPrs).values(prRow(9100000704, { filesBase: 'abc123' })),
    'gh_prs_files_base_form',
  ],
  [
    'an abbreviated commit on a review',
    (db) => reviewOnNewPr(db, { commitId: 'abc123' }),
    'gh_reviews_commit_id_form',
  ],
  [
    'an uppercase head on a check run',
    (db) => insertCheckRun(db, 9100000303, { headSha: uppercaseSha }),
    'gh_check_runs_head_sha_form',
  ],
  [
    'a check status outside the closed set',
    (db) => insertCheckRun(db, 9100000304, { status: 'done' }),
    'gh_check_runs_status_known',
  ],
  [
    'an issue state outside the closed set',
    (db) => insertIssue(db, 9100000801, 'merged'),
    'gh_issues_state_known',
  ],
  [
    'a milestone state outside the closed set',
    (db) => insertMilestone(db, 9100000901, 'merged'),
    'gh_milestones_state_known',
  ],
];

function columnRules(db: () => Db): void {
  it.each(columnRefusals)('refuses %s', async (_label, work, constraint) => {
    expect(await refusal(work(db()))).toEqual({ code: '23514', constraint });
  });

  it('accepts an open issue, a closed milestone and a queued check run', async () => {
    await insertIssue(db(), 9100000802, 'open');
    await insertMilestone(db(), 9100000902, 'closed');
    await insertCheckRun(db(), 9100000305, { status: 'queued' });
  });
}

function identityRules(db: () => Db): void {
  it('refuses a second repository whose name differs only in case', async () => {
    expect(await refusal(insertRepo(db(), 9100000003, 'UnfoldingWord/UW-Platform'))).toEqual({
      code: '23505',
      constraint: 'gh_repos_full_name_once',
    });
  });

  it('refuses two PRs with one number in one repository', async () => {
    await db()
      .insert(schema.ghPrs)
      .values(prRow(9100000501, { number: 501 }));
    expect(
      await refusal(
        db()
          .insert(schema.ghPrs)
          .values(prRow(9100000502, { number: 501 })),
      ),
    ).toEqual({ code: '23505', constraint: 'gh_prs_repo_number' });
  });

  it('refuses a PR that holds both a declaration and a declaration problem', async () => {
    const both = prRow(9100000601, { declaration: { closes: [] }, declarationProblem: 'two' });
    expect(await refusal(db().insert(schema.ghPrs).values(both))).toEqual({
      code: '23514',
      constraint: 'gh_prs_one_declaration_outcome',
    });
  });
}

function deliveryIndexRules(db: () => Db): void {
  it('indexes webhook_deliveries on received_at', async () => {
    const rows = await db()
      .select({ definition: indexes.indexdef })
      .from(indexes)
      .where(eq(indexes.indexname, 'webhook_deliveries_received_at'));
    expect(rows.map((row) => row.definition)).toEqual([
      'CREATE INDEX webhook_deliveries_received_at ON public.webhook_deliveries USING btree (received_at)',
    ]);
  });
}

function headRepositoryRules(db: () => Db): void {
  it('refuses a head repository that is not an owner and name, and accepts a fork or none', async () => {
    const pull = prRow(9100000205, { headRepo: 'someone/..' });
    expect(await refusal(db().insert(schema.ghPrs).values(pull))).toEqual({
      code: '23514',
      constraint: 'gh_prs_head_repo_form',
    });
    await db()
      .insert(schema.ghPrs)
      .values(prRow(9100000206, { headRepo: 'someone/uw-platform' }));
    await db()
      .insert(schema.ghPrs)
      .values(prRow(9100000207, { headRepo: null }));
  });
}

function describeTarget(target: DatabaseTarget): void {
  const db = openDatabase(target);
  describe('the read-model tables are keyed on the GitHub id, classified and timestamped', () =>
    readModelRules(db));
  describe('the read-model tables refuse malformed facts', () => factRules(db));
  describe('a pull request head repository is an owner and name or absent', () =>
    headRepositoryRules(db));
  describe('every read-model state and commit column refuses a value outside its form', () =>
    columnRules(db));
  describe('the read-model tables refuse a second row for one GitHub thing', () =>
    identityRules(db));
  describe('webhook deliveries can be read by when they arrived', () => deliveryIndexRules(db));
}

describe('the GitHub read-model tables', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => describeTarget(target),
  );
});
