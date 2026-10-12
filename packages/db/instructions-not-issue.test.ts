import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { harnessStages } from './schema.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

type Db = OpenedDatabase['db'];

const atText = '2026-10-01T09:00:00.000Z';
const harnessId = '00000000-0000-4000-8000-0000000000a1';
const skillPage = '00000000-0000-4000-8000-0000000000c1';
const issuePage = '00000000-0000-4000-8000-0000000000c2';
const guard = { code: '23514', constraint: 'harness_stages_instructions_not_issue' };

function idOf(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function insertPage(db: Db, id: string, type: string, slug: string) {
  return db.execute(sql`INSERT INTO pages (id, type, jd_area, slug, title, frontmatter, body_md,
      version, status)
    VALUES (${id}, ${type}, '80-89', ${slug}, 'Page', '{}'::jsonb, 'Body', 1, 'active')`);
}

function insertStage(db: Db, n: number, instructions: string | null) {
  return db.execute(sql`INSERT INTO harness_stages
    (id, harness_id, key, title, position, bracket, agent_pickup, exit_gate, instructions_page_id)
    VALUES (${idOf(n)}, ${harnessId}, ${`s${n}`}, 'Stage', ${n}, 'build_package', 'none',
      'checks', ${instructions})`);
}

function nameInstructions(db: Db, n: number, instructions: string) {
  return db.execute(
    sql`UPDATE harness_stages SET instructions_page_id = ${instructions} WHERE id = ${idOf(n)}`,
  );
}

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

async function seed(db: Db): Promise<void> {
  await db.execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at)
    VALUES (${harnessId}, 'software', 'software', '80-89', ${atText}::timestamptz)`);
  await insertPage(db, skillPage, 'skill', 'package-instructions');
  await insertPage(db, issuePage, 'issue', 'issue-42');
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

function instructionRules(db: () => Db): void {
  it('refuses a new stage whose instructions page is an issue page', async () => {
    expect(await refusal(insertStage(db(), 0x10, issuePage))).toEqual(guard);
  });

  it('refuses naming an issue page as the instructions of an existing stage', async () => {
    await insertStage(db(), 0x20, skillPage);
    expect(await refusal(nameInstructions(db(), 0x20, issuePage))).toEqual(guard);
  });

  it('accepts a skill page, and no page, as a stage instructions page', async () => {
    await insertStage(db(), 0x30, null);
    await nameInstructions(db(), 0x30, skillPage);
    const rows = await db()
      .select({ id: harnessStages.id })
      .from(harnessStages)
      .where(eq(harnessStages.instructionsPageId, skillPage))
      .orderBy(asc(harnessStages.id));
    expect(rows.map((row) => row.id)).toEqual([idOf(0x20), idOf(0x30)]);
  });
}

describe('a stage never takes its instructions from an issue page (the GH-3 SECURITY carry)', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => instructionRules(openDatabase(target)),
  );
});
