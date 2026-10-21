import { eq, inArray, sql } from 'drizzle-orm';
import { pgSchema, text } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { harnesses } from './schema.ts';
import { ghPrs, ghRepos } from './schema-github.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

type Db = OpenedDatabase['db'];

const pgConstraints = pgSchema('pg_catalog').table('pg_constraint', {
  name: text('conname'),
});

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

function insertHarness(db: Db, key: string, external: string) {
  return db.execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at, external_reviewer_identities)
    VALUES (gen_random_uuid(), ${key}, 'check-only', '80-89', now(), ${external}::text[])`);
}

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

function joiningColumns(db: () => Db): void {
  it('GL-4 PI-1 a harness starts out of shadow with no external reviewers', async () => {
    await db().execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at)
      VALUES (gen_random_uuid(), 'joining-defaults', 'check-only', '80-89', now())`);
    const rows = await db()
      .select({ shadow: harnesses.shadow, external: harnesses.externalReviewerIdentities })
      .from(harnesses)
      .where(eq(harnesses.key, 'joining-defaults'));
    expect(rows[0]).toEqual({ shadow: false, external: [] });
  });

  it('PI-1 refuses more than twenty external reviewers by harnesses_external_reviewers_bounded', async () => {
    const many = `{${Array.from({ length: 21 }, (_, n) => `r${n}`).join(',')}}`;
    expect(await refusal(insertHarness(db(), 'joining-many', many))).toEqual({
      code: '23514',
      constraint: 'harnesses_external_reviewers_bounded',
    });
  });

  it('GL-3 admits the new event and command names and the platform page type', async () => {
    const checks = await db()
      .select({
        name: pgConstraints.name,
        definition: sql<string>`pg_get_constraintdef(oid)`,
      })
      .from(pgConstraints)
      .where(
        inArray(pgConstraints.name, [
          'harness_events_name_known',
          'command_requests_command_known',
          'pages_type_known',
        ]),
      );
    const text = checks.map((row) => row.definition).join(' ');
    for (const name of [
      'shadow_verdict',
      'review_verdict_recorded',
      'shadow_lifted',
      'set_shadow',
      'platform',
    ]) {
      expect(text).toContain(`'${name}'`);
    }
  });
}

function requestedReviewersBound(db: () => Db): void {
  it('GL-3 refuses more than a hundred requested reviewers by gh_prs_requested_reviewers_bounded', async () => {
    const freshAt = new Date('2026-10-02T09:00:00.000Z');
    const sha = 'abcdef0123456789abcdef0123456789abcdef01';
    await db().insert(ghRepos).values({
      githubId: 9200000001,
      fullName: 'unfoldingWord/bounded',
      defaultBranch: 'main',
      private: false,
      freshAt,
    });
    const many = Array.from({ length: 101 }, (_, n) => `reviewer${n}`);
    const row = {
      githubId: 9200000101,
      repoId: 9200000001,
      number: 1,
      title: 'Many reviewers',
      state: 'open',
      draft: false,
      headSha: sha,
      headRef: 'branch',
      baseRef: 'main',
      baseSha: sha,
      githubUpdatedAt: freshAt,
      freshAt,
    };
    const refused = await refusal(
      db()
        .insert(ghPrs)
        .values({ ...row, requestedReviewers: many }),
    );
    expect(refused).toEqual({ code: '23514', constraint: 'gh_prs_requested_reviewers_bounded' });
    const kept = db()
      .insert(ghPrs)
      .values({ ...row, requestedReviewers: many.slice(1) });
    await expect(kept).resolves.toBeDefined();
  });
}

describe('the joining columns', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => {
      const db = openDatabase(target);
      joiningColumns(db);
      requestedReviewersBound(db);
    },
  );
});
