import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { pgSchema, text } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { harnesses } from './schema.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

const columns = pgSchema('information_schema').table('columns', {
  table: text('table_name'),
  name: text('column_name'),
  nullable: text('is_nullable'),
});
const constraints = pgSchema('pg_catalog').table('pg_constraint', { name: text('conname') });

type Db = OpenedDatabase['db'];

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

function observabilityColumns(db: () => Db): void {
  it('OB-4 a harness lists dependabot as a bot author by default', async () => {
    await db().execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at)
      VALUES (gen_random_uuid(), 'bots-default', 'check-only', '80-89', now())`);
    const rows = await db()
      .select({ bots: harnesses.botAuthors })
      .from(harnesses)
      .where(eq(harnesses.key, 'bots-default'));
    expect(rows[0]).toEqual({ bots: ['dependabot[bot]'] });
  });

  it('OB-4 refuses more than twenty bot authors by harnesses_bot_authors_bounded', async () => {
    const many = `{${Array.from({ length: 21 }, (_, n) => `b${n}`).join(',')}}`;
    const insert = db()
      .execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at, bot_authors)
      VALUES (gen_random_uuid(), 'bots-many', 'check-only', '80-89', now(), ${many}::text[])`);
    expect(await refusal(insert)).toEqual({
      code: '23514',
      constraint: 'harnesses_bot_authors_bounded',
    });
  });

  it('OB-2 OB-4 adds the held-since instant and the pull request author', async () => {
    const rows = await db()
      .select({ table: columns.table, name: columns.name, nullable: columns.nullable })
      .from(columns)
      .where(
        or(
          and(eq(columns.table, 'harness_items'), eq(columns.name, 'held_since')),
          and(eq(columns.table, 'gh_prs'), eq(columns.name, 'author_login')),
        ),
      )
      .orderBy(columns.table);
    expect(rows.map((row) => [row.table, row.name, row.nullable])).toEqual([
      ['gh_prs', 'author_login', 'YES'],
      ['harness_items', 'held_since', 'YES'],
    ]);
  });

  it('OB-1 GL-5 admits the new event and command names', async () => {
    const names = ['harness_events_name_known', 'command_requests_command_known'];
    const rows = await db()
      .select({ definition: sql<string>`pg_get_constraintdef(pg_constraint.oid)` })
      .from(constraints)
      .where(inArray(constraints.name, names));
    const text = rows.map((row) => row.definition).join(' ');
    for (const name of ['silence_alarm', 'template_changed', 'change_template']) {
      expect(text).toContain(`'${name}'`);
    }
  });
}

describe('the observability columns', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => observabilityColumns(openDatabase(target)),
  );
});
