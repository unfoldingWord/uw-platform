import { asc, eq, sql } from 'drizzle-orm';
import { pgSchema, text } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnyDatabase } from './any-database.ts';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { harnessEvents } from './schema.ts';
import { seedEvent, seedHarness, seedItem, seededEventId } from './test-seed.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

const harnessA = '00000000-0000-4000-8000-0000000000b1';
const harnessB = '00000000-0000-4000-8000-0000000000b2';
const stageB = '00000000-0000-4000-8000-0000000000c2';
const itemB = '00000000-0000-4000-8000-0000000000d2';

const pgClass = pgSchema('pg_catalog').table('pg_class', { relname: text('relname') });

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
    .from(pgClass)
    .where(eq(pgClass.relname, 'harness_events'));
  return row?.allowed === true;
}

function openDatabase(target: DatabaseTarget): () => AnyDatabase {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
    await seedHarness(opened.db, { id: harnessA, key: 'software', jdArea: '80-89' });
    await seedHarness(opened.db, { id: harnessB, key: 'bml', jdArea: '10-19' });
    await seedItem(opened.db, { id: itemB, harnessId: harnessB, stageId: stageB });
    await opened.db.insert(harnessEvents).values([1, 2].map((n) => eventRow(n)));
    await seedEvent(opened.db, { harnessId: harnessA, n: 3 });
    await seedEvent(opened.db, { harnessId: harnessB, n: 1 });
    await seedEvent(opened.db, { harnessId: harnessB, n: 2 });
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

function eventRow(n: number) {
  return {
    id: seededEventId(harnessA, n),
    harnessId: harnessA,
    name: 'item_created',
    actor: 'human:00000000-0000-4000-8000-000000000001',
    evidence: {},
    traceId: '00000000-0000-4000-8000-0000000000e1',
    at: new Date('2026-10-01T09:00:00.000Z'),
  };
}

function positionRules(db: () => AnyDatabase): void {
  it('numbers each harness from 1, one position per event', async () => {
    expect(await positionsOf(db(), harnessA)).toEqual([1, 2, 3]);
    expect(await positionsOf(db(), harnessB)).toEqual([1, 2]);
  });

  it('stores a supplied position at the next position instead', async () => {
    await seedEvent(db(), { harnessId: harnessB, n: 3, position: 99 });
    expect(await positionsOf(db(), harnessB)).toEqual([1, 2, 3]);
  });
}

function appendOnlyRules(db: () => AnyDatabase): void {
  it('refuses an update, a delete and a truncate by trigger', async () => {
    const changed = db().execute(sql`UPDATE harness_events SET name = name`);
    const removed = db().execute(sql`DELETE FROM harness_events`);
    const emptied = db().execute(sql`TRUNCATE harness_events`);
    expect((await refusal(changed)).code).toBe('P0001');
    expect((await refusal(removed)).code).toBe('P0001');
    expect((await refusal(emptied)).code).toBe('P0001');
  });

  it('refuses a name outside the event vocabulary', async () => {
    const unknown = { code: '23514', constraint: 'harness_events_name_known' };
    expect(await refusal(seedEvent(db(), { harnessId: harnessA, n: 90, name: 'merged' }))).toEqual(
      unknown,
    );
    expect(
      await refusal(seedEvent(db(), { harnessId: harnessA, n: 91, name: 'abandoned' })),
    ).toEqual(unknown);
  });

  it('refuses an actor that is not an identity', async () => {
    const stranger = seedEvent(db(), { harnessId: harnessA, n: 94, actor: 'nobody' });
    expect(await refusal(stranger)).toEqual({
      code: '23514',
      constraint: 'harness_events_actor_is_identity',
    });
  });

  it('refuses an item of another harness', async () => {
    const crossed = seedEvent(db(), { harnessId: harnessA, n: 92, itemId: itemB });
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
      await tx.execute(sql`UPDATE harness_events SET name = name`);
    });
    expect((await refusal(changed)).code).toBe('42501');
    const before = await positionsOf(db(), harnessA);
    await db().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE uw_app`);
      await seedEvent(tx, { harnessId: harnessA, n: 93 });
    });
    expect((await positionsOf(db(), harnessA)).at(-1)).toBe((before.at(-1) ?? 0) + 1);
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
