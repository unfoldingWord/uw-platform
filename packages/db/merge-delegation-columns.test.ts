import { eq, inArray, sql } from 'drizzle-orm';
import { pgSchema, text } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { harnesses } from './schema.ts';
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

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

const personId = '00000000-0000-4000-8000-00000000d001';

async function harnessFor(db: Db, key: string): Promise<string> {
  await db.execute(sql`INSERT INTO people (id, email, display_name, status)
    VALUES (${personId}, 'grantor@unfoldingword.org', 'grantor@unfoldingword.org', 'active')
    ON CONFLICT (id) DO NOTHING`);
  const id = crypto.randomUUID();
  await db
    .insert(harnesses)
    .values({ id, key, template: 'software', jdArea: '80-89', createdAt: new Date() });
  return id;
}

function delegate(db: Db, harnessId: string, capability: string, maxTier: string | null) {
  return db.execute(sql`INSERT INTO delegations
    (id, person_id, persona, harness_id, capability, granted_at, expires_at, trace_id, max_tier)
    VALUES (gen_random_uuid(), ${personId}, 'agent:shipper', ${harnessId}, ${capability},
      now(), now() + interval '1 day', gen_random_uuid(), ${maxTier})`);
}

async function definitions(db: Db, names: readonly string[]): Promise<string> {
  const rows = await db
    .select({ definition: sql<string>`pg_get_constraintdef(oid)` })
    .from(pgConstraints)
    .where(inArray(pgConstraints.name, [...names]));
  return rows.map((row) => row.definition).join(' ');
}

function tierAndPaths(db: () => Db): void {
  it('MD-2 a merge delegation carries low or standard, and only a merge delegation carries a tier', async () => {
    const harnessId = await harnessFor(db(), 'merge-tiers');
    await delegate(db(), harnessId, 'merge', 'standard');
    await delegate(db(), harnessId, 'merge', 'low');
    await delegate(db(), harnessId, 'build', null);
    expect(await refusal(delegate(db(), harnessId, 'merge', 'high'))).toEqual({
      code: '23514',
      constraint: 'delegations_max_tier_known',
    });
    expect(await refusal(delegate(db(), harnessId, 'merge', null))).toEqual({
      code: '23514',
      constraint: 'delegations_merge_has_max_tier',
    });
    expect(await refusal(delegate(db(), harnessId, 'build', 'low'))).toEqual({
      code: '23514',
      constraint: 'delegations_merge_has_max_tier',
    });
  });

  it('MD-4 a harness lists at most fifty protected paths and starts with none', async () => {
    const harnessId = await harnessFor(db(), 'merge-paths');
    const rows = await db()
      .select({ paths: harnesses.protectedPaths })
      .from(harnesses)
      .where(eq(harnesses.id, harnessId));
    expect(rows[0]?.paths).toEqual([]);
    const many = `{${Array.from({ length: 51 }, (_, n) => `p${n}/`).join(',')}}`;
    const update = db().execute(
      sql`UPDATE harnesses SET protected_paths = ${many}::text[] WHERE id = ${harnessId}`,
    );
    expect(await refusal(update)).toEqual({
      code: '23514',
      constraint: 'harnesses_protected_paths_bounded',
    });
  });
}

function delegatedDecisionChecks(db: () => Db): void {
  it('MD-3 an agent actor requires a delegation, a delegated row approves a merge, and the approver check is unchanged', async () => {
    const text = await definitions(db(), [
      'gate_decisions_actor_is_human',
      'gate_decisions_agent_with_delegation',
      'gate_decisions_agent_actor_is_agent',
      'gate_decisions_delegated_approves_merge',
    ]);
    expect(text).toContain('(agent_actor IS NULL) = (delegation_id IS NULL)');
    expect(text).toContain("'^agent:");
    expect(text).toContain("NOT ((evidence ->> 'connector'::text) IS DISTINCT FROM 'merge'::text)");
    expect(text).toContain("decision = 'approve'::text");
    expect(text).toContain("'^human:");
    expect(await definitions(db(), ['gate_decisions_delegation_fk'])).toBe(
      'FOREIGN KEY (delegation_id, harness_id) REFERENCES delegations(id, harness_id)',
    );
    expect(await definitions(db(), ['gate_decisions_lent_binding_fk'])).toBe(
      'FOREIGN KEY (delegation_id, harness_id, agent_actor, delegated_capability, actor) REFERENCES delegations(id, harness_id, persona, capability, grantor)',
    );
  });

  it('MD-6 admits the delegated_merge event name', async () => {
    expect(await definitions(db(), ['harness_events_name_known'])).toContain("'delegated_merge'");
  });
}

describe('the merge delegation columns', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => {
      const db = openDatabase(target);
      tierAndPaths(db);
      delegatedDecisionChecks(db);
    },
  );
});
