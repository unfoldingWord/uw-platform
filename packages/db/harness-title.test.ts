import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from './embedded.ts';
import { harnesses } from './schema.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

type Db = OpenedDatabase['db'];

const migration = readFileSync(
  new URL('./migrations/0040_harness_title.sql', import.meta.url),
  'utf8',
);
const titleStatements = migration
  .split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter((statement) => statement.includes('"harnesses"'));

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

function titleColumn(db: () => Db): void {
  it('UI-18 the migration adds the column, backfills title from key, then sets not null', async () => {
    expect(titleStatements).toEqual([
      'ALTER TABLE "harnesses" ADD COLUMN "title" text;',
      'UPDATE "harnesses" SET "title" = "key";',
      'ALTER TABLE "harnesses" ALTER COLUMN "title" SET NOT NULL;',
    ]);
    await db().execute(sql`ALTER TABLE harnesses DROP COLUMN title`);
    await db().execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at)
      VALUES (gen_random_uuid(), 'bml', 'bml', '80-89', now())`);
    for (const statement of titleStatements) await db().execute(sql.raw(statement));
    const rows = await db()
      .select({ title: harnesses.title })
      .from(harnesses)
      .where(eq(harnesses.key, 'bml'));
    expect(rows).toEqual([{ title: 'bml' }]);
  });

  it('UI-18 a harness inserted without a title is refused, because the column has no default', async () => {
    await expect(
      db().execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at)
        VALUES (gen_random_uuid(), 'untitled', 'software', '80-89', now())`),
    ).rejects.toThrow();
  });
}

describe('the harness title column', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => titleColumn(openDatabase(target)),
  );
});
