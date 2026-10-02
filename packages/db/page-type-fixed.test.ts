import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { pages } from './schema.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

type Db = OpenedDatabase['db'];

const skillPage = '00000000-0000-4000-8000-0000000000c1';
const issuePage = '00000000-0000-4000-8000-0000000000c2';
const guard = { code: '23514', constraint: 'pages_type_fixed' };

function insertPage(db: Db, id: string, type: string, slug: string) {
  return db.execute(sql`INSERT INTO pages (id, type, jd_area, slug, title, frontmatter, body_md,
      version, status)
    VALUES (${id}, ${type}, '80-89', ${slug}, 'Page', '{}'::jsonb, 'Body', 1, 'active')`);
}

function retype(db: Db, id: string, type: string) {
  return db.execute(sql`UPDATE pages SET type = ${type} WHERE id = ${id}`);
}

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

async function typeOf(db: Db, id: string): Promise<string | undefined> {
  const [row] = await db.select({ type: pages.type }).from(pages).where(eq(pages.id, id));
  return row?.type;
}

function openDatabase(target: DatabaseTarget): () => Db {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
    await insertPage(opened.db, skillPage, 'skill', 'stage-instructions');
    await insertPage(opened.db, issuePage, 'issue', 'issue-42');
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

function typeRules(db: () => Db): void {
  it('refuses turning a page into an issue page, and an issue page into another type', async () => {
    expect(await refusal(retype(db(), skillPage, 'issue'))).toEqual(guard);
    expect(await refusal(retype(db(), issuePage, 'product'))).toEqual(guard);
    expect([await typeOf(db(), skillPage), await typeOf(db(), issuePage)]).toEqual([
      'skill',
      'issue',
    ]);
  });

  it('accepts an update that leaves the type as it is', async () => {
    await db().execute(
      sql`UPDATE pages SET type = 'skill', title = 'Kept' WHERE id = ${skillPage}`,
    );
    const [row] = await db()
      .select({ title: pages.title })
      .from(pages)
      .where(eq(pages.id, skillPage));
    expect(row?.title).toBe('Kept');
  });
}

describe("a page's type never changes, so the instructions guard holds (the GH-3 SECURITY carry)", () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => typeRules(openDatabase(target)),
  );
});
