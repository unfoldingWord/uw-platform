import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnyDatabase } from './any-database.ts';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { eventId, harnessA, harnessB, insertEvent, seedHarness } from './event-log-fixtures.ts';
import { harnessEvents } from './schema.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

const stageB = '00000000-0000-4000-8000-0000000000c2';
const itemB = '00000000-0000-4000-8000-0000000000d2';
const at = '2026-10-01T09:00:00.000Z';
const actor = 'human:00000000-0000-4000-8000-000000000001';
const traceId = '00000000-0000-4000-8000-0000000000e1';

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

async function positionsOf(db: AnyDatabase, harnessId: string): Promise<number[]> {
  const rows = await db
    .select({ position: harnessEvents.position })
    .from(harnessEvents)
    .where(eq(harnessEvents.harnessId, harnessId))
    .orderBy(asc(harnessEvents.position));
  return rows.map((row) => row.position);
}

async function privilege(db: AnyDatabase, name: string): Promise<boolean> {
  const [row] = await db
    .select({
      allowed: sql<boolean>`has_table_privilege('uw_app', 'harness_events', ${name})`,
    })
    .from(harnessEvents)
    .limit(1);
  return row?.allowed === true;
}

async function seedItemOfB(db: AnyDatabase): Promise<void> {
  await db.execute(sql`INSERT INTO harness_stages
    (id, harness_id, key, title, position, bracket, agent_pickup, exit_gate, connector)
    VALUES (${stageB}, ${harnessB}, 'ship', 'Stage', 1, 'deploy_package', 'none', 'human_approval', 'none')`);
  await db.execute(sql`INSERT INTO harness_items (id, harness_id, stage_id, title, created_at)
    VALUES (${itemB}, ${harnessB}, ${stageB}, 'Item', ${at}::timestamptz)`);
}

function openDatabase(target: DatabaseTarget): () => AnyDatabase {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
    await seedHarness(opened.db, harnessA, 'software', '80-89');
    await seedHarness(opened.db, harnessB, 'bml', '10-19');
    await seedItemOfB(opened.db);
    await opened.db
      .execute(sql`INSERT INTO harness_events (id, harness_id, item_id, name, actor, evidence, trace_id, at)
      VALUES (${eventId(harnessA, 1)}, ${harnessA}, NULL, 'item_created', ${actor}, '{}'::jsonb, ${traceId}, ${at}::timestamptz),
        (${eventId(harnessA, 2)}, ${harnessA}, NULL, 'item_created', ${actor}, '{}'::jsonb, ${traceId}, ${at}::timestamptz)`);
    await insertEvent(opened.db, harnessA, 3);
    await insertEvent(opened.db, harnessB, 1);
    await insertEvent(opened.db, harnessB, 2);
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

function positionRules(db: () => AnyDatabase): void {
  it('numbers each harness from 1, one position per event', async () => {
    expect(await positionsOf(db(), harnessA)).toEqual([1, 2, 3]);
    expect(await positionsOf(db(), harnessB)).toEqual([1, 2]);
  });

  it('stores a supplied position at the next position instead', async () => {
    await db()
      .execute(sql`INSERT INTO harness_events (id, harness_id, item_id, position, name, actor, evidence, trace_id, at)
      VALUES (${eventId(harnessB, 3)}, ${harnessB}, NULL, 99, 'item_created', ${actor}, '{}'::jsonb, ${traceId}, ${at}::timestamptz)`);
    expect(await positionsOf(db(), harnessB)).toEqual([1, 2, 3]);
  });
}

function appendOnlyRules(db: () => AnyDatabase): void {
  it('refuses an update, a delete and a truncate by trigger', async () => {
    const changed = db().execute(sql`UPDATE harness_events SET actor = ${actor}`);
    const removed = db().execute(sql`DELETE FROM harness_events`);
    const emptied = db().execute(sql`TRUNCATE harness_events`);
    expect((await refusal(changed)).code).toBe('P0001');
    expect((await refusal(removed)).code).toBe('P0001');
    expect((await refusal(emptied)).code).toBe('P0001');
  });

  it('refuses a name outside the event vocabulary', async () => {
    const merged = { code: '23514', constraint: 'harness_events_name_known' };
    expect(await refusal(insertEvent(db(), harnessA, 90, 'merged'))).toEqual(merged);
    expect(await refusal(insertEvent(db(), harnessA, 91, 'abandoned'))).toEqual(merged);
  });

  it('refuses an item of another harness', async () => {
    const crossed = db()
      .execute(sql`INSERT INTO harness_events (id, harness_id, item_id, name, actor, evidence, trace_id, at)
      VALUES (${eventId(harnessA, 92)}, ${harnessA}, ${itemB}, 'item_created', ${actor}, '{}'::jsonb, ${traceId}, ${at}::timestamptz)`);
    expect(await refusal(crossed)).toEqual({ code: '23503', constraint: 'harness_events_item_fk' });
  });
}

function roleRules(db: () => AnyDatabase): void {
  it('gives the application role select and insert and nothing that changes a row', async () => {
    expect(await privilege(db(), 'UPDATE')).toBe(false);
    expect(await privilege(db(), 'DELETE')).toBe(false);
    expect(await privilege(db(), 'TRUNCATE')).toBe(false);
    expect(await privilege(db(), 'SELECT')).toBe(true);
    expect(await privilege(db(), 'INSERT')).toBe(true);
  });

  it('refuses the application role an update and lets it append', async () => {
    const changed = db().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE uw_app`);
      await tx.execute(sql`UPDATE harness_events SET actor = ${actor}`);
    });
    expect((await refusal(changed)).code).toBe('42501');
    await db().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE uw_app`);
      await insertEvent(tx, harnessA, 93);
    });
    expect((await positionsOf(db(), harnessA)).at(-1)).toBe(4);
  });
}

function describeTarget(target: DatabaseTarget): void {
  const db = openDatabase(target);
  positionRules(db);
  appendOnlyRules(db);
  roleRules(db);
}

describe('KN-3 DX-6 harness_events is append-only and positioned per harness', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => describeTarget(target),
  );
});
