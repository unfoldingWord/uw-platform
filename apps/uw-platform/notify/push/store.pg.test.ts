import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedPerson } from '@uw/db/test-seed';
import { testServer, withAppDatabase } from '../../testing/postgres.ts';
import { endpointFor, subscription } from '../testing.ts';
import { pushStore } from './store.ts';

const ana = 'c6100000-0000-4000-8000-000000000001';
const ben = 'c6100000-0000-4000-8000-000000000002';
const start = new Date('2026-10-04T09:00:00.000Z');

function later(seconds: number): Date {
  return new Date(start.getTime() + seconds * 1000);
}

async function withPeople(work: (db: Database) => Promise<void>): Promise<void> {
  await withAppDatabase(async (db) => {
    await seedPerson(db, { id: ana, email: 'push-ana@unfoldingword.org' });
    await seedPerson(db, { id: ben, email: 'push-ben@unfoldingword.org' });
    await work(db);
  });
}

async function owners(db: Database): Promise<Record<string, string>> {
  const rows = await db.execute<{ endpoint: string; person_id: string }>(
    sql`SELECT endpoint, person_id FROM push_subscriptions ORDER BY endpoint`,
  );
  return Object.fromEntries(rows.map((row) => [row.endpoint, row.person_id]));
}

async function movesEndpoint(db: Database): Promise<void> {
  const store = pushStore(db);
  await store.subscribe(ana, await subscription(endpointFor('one')), start);
  expect(await owners(db)).toEqual({ [endpointFor('one')]: ana });
  await store.subscribe(ben, await subscription(endpointFor('one')), later(1));
  expect(await owners(db)).toEqual({ [endpointFor('one')]: ben });
  expect((await store.devicesOf(ana, later(2))).devices).toEqual([]);
}

async function keepsTwenty(db: Database): Promise<void> {
  const store = pushStore(db);
  for (let n = 0; n < 21; n += 1) {
    await store.subscribe(ana, await subscription(endpointFor(`d${n}`)), later(n));
  }
  const endpoints = (await store.devicesOf(ana, later(30))).devices.map((d) => d.endpoint);
  expect(endpoints).toHaveLength(20);
  expect(endpoints).not.toContain(endpointFor('d0'));
  expect(endpoints[0]).toBe(endpointFor('d1'));
}

async function deletesExpired(db: Database): Promise<void> {
  const store = pushStore(db);
  await store.subscribe(ana, await subscription(endpointFor('old'), later(60).getTime()), start);
  await store.subscribe(ana, await subscription(endpointFor('new')), start);
  const read = await store.devicesOf(ana, later(60));
  expect(read.expired).toBe(1);
  expect(read.devices.map((device) => device.endpoint)).toEqual([endpointFor('new')]);
  expect(Object.keys(await owners(db))).toEqual([endpointFor('new')]);
}

async function ownRowsOnly(db: Database): Promise<void> {
  const store = pushStore(db);
  await store.subscribe(ana, await subscription(endpointFor('a')), start);
  await store.subscribe(ben, await subscription(endpointFor('b')), start);
  expect(await store.unsubscribe(ana, endpointFor('b'))).toBe(false);
  expect(await store.unsubscribe(ana, endpointFor('a'))).toBe(true);
  expect(await owners(db)).toEqual({ [endpointFor('b')]: ben });
  await store.prune(endpointFor('b'));
  expect(await owners(db)).toEqual({});
}

async function claimsWindows(db: Database): Promise<void> {
  const store = pushStore(db);
  expect(await store.claimWindow(ana, 2, start)).toBe(true);
  expect(await store.claimWindow(ana, 2, later(300))).toBe(false);
  expect(await store.claimWindow(ana, 3, later(360))).toBe(true);
  expect(await store.claimWindow(ana, 3, later(959))).toBe(false);
  expect(await store.claimWindow(ana, 1, later(960))).toBe(true);
}

describe.skipIf(!testServer)('the push subscription store', () => {
  it('subscribes, and a re-subscribe by another person moves the endpoint to them', () =>
    withPeople(movesEndpoint));

  it('keeps at most 20 devices per person, removing the oldest', () => withPeople(keepsTwenty));

  it('deletes expired devices when it reads them and counts them', () =>
    withPeople(deletesExpired));

  it('unsubscribes only the caller’s own row, and prunes by endpoint', () =>
    withPeople(ownRowsOnly));

  it('claims a window, coalesces an equal rank inside ten minutes, and opens again at ten minutes or for a stronger rank', () =>
    withPeople(claimsWindows));
});
