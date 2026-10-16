import { and, eq, inArray, sql } from 'drizzle-orm';
import { pgSchema, text } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { ghIssues } from './schema-github.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

type Db = OpenedDatabase['db'];

const columns = pgSchema('information_schema').table('columns', {
  table: text('table_name'),
  name: text('column_name'),
  fallback: text('column_default'),
});
const pgConstraints = pgSchema('pg_catalog').table('pg_constraint', { name: text('conname') });

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

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

async function seedRepo(db: Db, githubId: number): Promise<void> {
  await db.execute(sql`INSERT INTO gh_repos (github_id, full_name, default_branch, private, fresh_at)
    VALUES (${githubId}, ${`unfoldingWord/epic-${githubId}`}, 'main', true, now())`);
}

function insertIssue(db: Db, repoId: number, number: number) {
  return db.execute(sql`INSERT INTO gh_issues
    (github_id, repo_id, number, title, state, github_updated_at, fresh_at)
    VALUES (${repoId * 100 + number}, ${repoId}, ${number}, 'Epic intake', 'open', now(), now())`);
}

function insertChildWithoutPlace(db: Db, repoId: number, number: number, parentId: number) {
  return db.execute(sql`INSERT INTO gh_issues
    (github_id, repo_id, number, title, state, github_updated_at, fresh_at, parent_issue_id)
    VALUES (${repoId * 100 + number}, ${repoId}, ${number}, 'Epic intake', 'open', now(), now(), ${parentId})`);
}

function issueColumns(db: () => Db): void {
  it('EI-1 an issue starts with no parent, no sub-issues, no done-when and no blockers', async () => {
    await seedRepo(db(), 91001);
    await insertIssue(db(), 91001, 1);
    const rows = await db()
      .select({
        parentIssueId: ghIssues.parentIssueId,
        parentPosition: ghIssues.parentPosition,
        subIssues: ghIssues.subIssues,
        doneWhen: ghIssues.doneWhen,
        blockedBy: ghIssues.blockedBy,
      })
      .from(ghIssues)
      .where(eq(ghIssues.githubId, 91001 * 100 + 1));
    expect(rows[0]).toEqual({
      parentIssueId: null,
      parentPosition: null,
      subIssues: 0,
      doneWhen: [],
      blockedBy: [],
    });
  });

  it('EI-1 refuses a parent without a place by gh_issues_parent_with_place', async () => {
    await seedRepo(db(), 91002);
    expect(await refusal(insertChildWithoutPlace(db(), 91002, 2, 9100000340))).toEqual({
      code: '23514',
      constraint: 'gh_issues_parent_with_place',
    });
  });
}

function itemColumns(db: () => Db): void {
  it('EI-3 an item starts in no epic with no blockers', async () => {
    const rows = await db()
      .select({ name: columns.name, fallback: columns.fallback })
      .from(columns)
      .where(and(eq(columns.table, 'harness_items'), inArray(columns.name, ['epic', 'blocked_by'])))
      .orderBy(columns.name);
    expect(rows.map((row) => row.name)).toEqual(['blocked_by', 'epic']);
    expect(rows[0]?.fallback).toContain("'{}'");
    expect(rows[1]?.fallback).toBeNull();
  });

  it('EI-2 EI-3 admits the new event and command names', async () => {
    const checks = await db()
      .select({ definition: sql<string>`pg_get_constraintdef(oid)` })
      .from(pgConstraints)
      .where(
        inArray(pgConstraints.name, [
          'harness_events_name_known',
          'command_requests_command_known',
        ]),
      );
    const definitions = checks.map((row) => row.definition).join(' ');
    for (const name of ['epic_enqueued', 'done_when_missing', 'enqueue_epic']) {
      expect(definitions).toContain(`'${name}'`);
    }
  });
}

describe('the epic intake columns', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => {
      const db = openDatabase(target);
      issueColumns(db);
      itemColumns(db);
    },
  );
});
