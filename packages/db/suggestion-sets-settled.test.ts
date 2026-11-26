import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { pageSuggestionSets } from './schema.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

type Db = OpenedDatabase['db'];

const policyPage = '00000000-0000-4000-8000-0000000000d1';
const pending = '00000000-0000-4000-8000-0000000000d2';
const decided = '00000000-0000-4000-8000-0000000000d3';
const guard = { code: '23514', constraint: 'page_suggestion_sets_settled' };
const person = 'human:00000000-0000-4000-8000-0000000000d9';
const decisionRequest = '00000000-0000-4000-8000-0000000000d8';

function insertSet(db: Db, id: string, proposer: string) {
  return db.execute(sql`INSERT INTO page_suggestion_sets (id, page_id, base_version, title,
      frontmatter, body_md, proposed_by, proposed_at, status)
    VALUES (${id}, ${policyPage}, 1, 'Policy', '{}'::jsonb, 'Body', ${proposer}, now(), 'pending')`);
}

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

function openDatabase(target: DatabaseTarget): () => Db {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
    await opened.db.execute(sql`INSERT INTO pages (id, type, jd_area, slug, title, frontmatter,
        body_md, version, status)
      VALUES (${policyPage}, 'policy', '00-09', 'policy', 'Policy', '{}'::jsonb, 'Body', 1, 'active')`);
    await insertSet(opened.db, pending, 'agent:builder');
    await insertSet(opened.db, decided, 'agent:reviewer');
    await opened.db.execute(sql`UPDATE page_suggestion_sets
      SET status = 'rejected', decided_by = ${person}, decided_at = now(),
        decision_request_id = ${decisionRequest} WHERE id = ${decided}`);
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

function settledRules(db: () => Db): void {
  it('refuses changing or deleting a decided set', async () => {
    const reopen = sql`UPDATE page_suggestion_sets SET status = 'pending', decided_by = NULL,
      decided_at = NULL, decision_request_id = NULL WHERE id = ${decided}`;
    expect(await refusal(db().execute(reopen))).toEqual(guard);
    const drop = sql`DELETE FROM page_suggestion_sets WHERE id = ${decided}`;
    expect(await refusal(db().execute(drop))).toEqual(guard);
  });

  it('refuses moving a pending set to another proposer, and accepts a new proposal text', async () => {
    const steal = sql`UPDATE page_suggestion_sets SET proposed_by = 'agent:other' WHERE id = ${pending}`;
    expect(await refusal(db().execute(steal))).toEqual(guard);
    await db().execute(
      sql`UPDATE page_suggestion_sets SET body_md = 'Revised' WHERE id = ${pending}`,
    );
    const rows = await db()
      .select({ bodyMd: pageSuggestionSets.bodyMd })
      .from(pageSuggestionSets)
      .where(eq(pageSuggestionSets.id, pending));
    expect(rows).toEqual([{ bodyMd: 'Revised' }]);
  });
}

describe('PO-7 a decided suggestion set is kept as it was decided', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => settledRules(openDatabase(target)),
  );
});
