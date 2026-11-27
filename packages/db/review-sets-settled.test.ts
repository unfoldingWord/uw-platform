import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { pageSuggestedChanges } from './schema.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

type Db = OpenedDatabase['db'];

const policyPage = '00000000-0000-4000-8000-0000000000e1';
const pending = '00000000-0000-4000-8000-0000000000e2';
const decided = '00000000-0000-4000-8000-0000000000e3';
const pendingChange = '00000000-0000-4000-8000-0000000000e4';
const decidedChange = '00000000-0000-4000-8000-0000000000e5';
const decision = '00000000-0000-4000-8000-0000000000e6';
const person = 'human:00000000-0000-4000-8000-0000000000e9';
const decisionRequest = '00000000-0000-4000-8000-0000000000e8';

function insertSet(db: Db, id: string, author: string) {
  return db.execute(sql`INSERT INTO page_review_sets (id, page_id, name, base_version, status,
      created_by, created_at, request_id)
    VALUES (${id}, ${policyPage}, 'Board review', 1, 'pending', ${author}, now(), gen_random_uuid())`);
}

function insertChange(db: Db, id: string, reviewSetId: string, position: number) {
  return db.execute(sql`INSERT INTO page_suggested_changes (id, review_set_id, position, kind,
      start_offset, end_offset, exact, prefix, suffix, proposed_text, note, author, created_at)
    VALUES (${id}, ${reviewSetId}, ${position}, 'replacement', 0, 3, 'Two', '', ' adults',
      'Three', NULL, 'agent:builder', now())`);
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
  await db.execute(sql`INSERT INTO pages (id, type, jd_area, slug, title, frontmatter,
      body_md, version, status)
    VALUES (${policyPage}, 'policy', '00-09', 'policy', 'Policy', '{}'::jsonb,
      'Two adults are present.', 1, 'active')`);
  await insertSet(db, pending, 'agent:builder');
  await insertSet(db, decided, 'agent:reviewer');
  await insertChange(db, pendingChange, pending, 0);
  await insertChange(db, decidedChange, decided, 0);
  await db.execute(sql`UPDATE page_review_sets
    SET status = 'rejected', decided_by = ${person}, decided_at = now(),
      decision_request_id = ${decisionRequest} WHERE id = ${decided}`);
  await db.execute(sql`INSERT INTO page_review_decisions (id, review_set_id, page_id, decision,
      decided_by, decided_at, request_id, trace_id)
    VALUES (${decision}, ${decided}, ${policyPage}, 'rejected', ${person}, now(),
      ${decisionRequest}, 'trace')`);
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

const setGuard = { code: '23514', constraint: 'page_review_sets_settled' };
const changeGuard = { code: '23514', constraint: 'page_suggested_changes_settled' };
const auditGuard = { code: '23514', constraint: 'page_review_decisions_append_only' };

function settledRules(db: () => Db): void {
  it('refuses reopening or deleting a decided review set', async () => {
    const reopen = sql`UPDATE page_review_sets SET status = 'pending', decided_by = NULL,
      decided_at = NULL, decision_request_id = NULL WHERE id = ${decided}`;
    expect(await refusal(db().execute(reopen))).toEqual(setGuard);
    const drop = sql`DELETE FROM page_review_sets WHERE id = ${decided}`;
    expect(await refusal(db().execute(drop))).toEqual(setGuard);
  });

  it('refuses adding, changing or removing the changes of a decided set', async () => {
    expect(await refusal(insertChange(db(), crypto.randomUUID(), decided, 1))).toEqual(changeGuard);
    const edit = sql`UPDATE page_suggested_changes SET proposed_text = 'Four'
      WHERE id = ${decidedChange}`;
    expect(await refusal(db().execute(edit))).toEqual(changeGuard);
    const drop = sql`DELETE FROM page_suggested_changes WHERE id = ${decidedChange}`;
    expect(await refusal(db().execute(drop))).toEqual(changeGuard);
    const move = sql`UPDATE page_suggested_changes SET review_set_id = ${decided}
      WHERE id = ${pendingChange}`;
    expect(await refusal(db().execute(move))).toEqual(changeGuard);
  });

  it('lets a pending set take new changes and refuses moving it to another author', async () => {
    const steal = sql`UPDATE page_review_sets SET created_by = 'agent:other' WHERE id = ${pending}`;
    expect(await refusal(db().execute(steal))).toEqual(setGuard);
    await db().execute(sql`DELETE FROM page_suggested_changes WHERE id = ${pendingChange}`);
    await insertChange(db(), crypto.randomUUID(), pending, 1);
    const rows = await db()
      .select({ position: pageSuggestedChanges.position })
      .from(pageSuggestedChanges)
      .where(eq(pageSuggestedChanges.reviewSetId, pending));
    expect(rows).toEqual([{ position: 1 }]);
  });

  it('keeps every review decision as it was recorded', async () => {
    const edit = sql`UPDATE page_review_decisions SET decision = 'accepted', accepted_version = 2
      WHERE id = ${decision}`;
    expect(await refusal(db().execute(edit))).toEqual(auditGuard);
    const drop = sql`DELETE FROM page_review_decisions WHERE id = ${decision}`;
    expect(await refusal(db().execute(drop))).toEqual(auditGuard);
  });
}

describe('#197 a decided review set and its audit row are kept as they were decided', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => settledRules(openDatabase(target)),
  );
});
