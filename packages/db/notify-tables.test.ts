import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnyDatabase } from './any-database.ts';
import { declarationOf } from './declarations.ts';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import * as schema from './schema.ts';
import { seedEvent, seedHarness, seedPerson } from './test-seed.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

const harnessId = '00000000-0000-4000-8000-0000000000b1';
const person = '00000000-0000-4000-8000-0000000000e9';
const stranger = '00000000-0000-4000-8000-0000000000ff';
const atText = '2026-10-03T09:00:00.000Z';

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

function subscribe(db: AnyDatabase, endpoint: string, personId: string) {
  return db.execute(sql`INSERT INTO push_subscriptions
      (endpoint, person_id, p256dh, auth, expires_at, created_at)
    VALUES (${endpoint}, ${personId}, 'p', 'a', NULL, ${atText}::timestamptz)`);
}

function cooldown(db: AnyDatabase, rank: number) {
  return db.execute(sql`INSERT INTO push_cooldowns (person_id, window_started_at, rank)
    VALUES (${person}, ${atText}::timestamptz, ${rank})
    ON CONFLICT (person_id) DO UPDATE SET rank = excluded.rank`);
}

function openDatabase(target: DatabaseTarget): () => AnyDatabase {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
    await seedPerson(opened.db, { id: person, email: 'ana@example.org' });
    await seedHarness(opened.db, { id: harnessId, key: 'software', jdArea: '80-89' });
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

function declarationRules(): void {
  it('declares push_subscriptions restricted and push_cooldowns internal, neither offline', () => {
    expect(declarationOf(schema.pushSubscriptions)).toEqual({
      classification: 'restricted',
      offlineEligibility: 'never',
    });
    expect(declarationOf(schema.pushCooldowns)).toEqual({
      classification: 'internal',
      offlineEligibility: 'never',
    });
  });
}

function subscriptionRules(db: () => AnyDatabase): void {
  it('keeps a subscription for a known person', async () => {
    await subscribe(db(), 'https://fcm.googleapis.com/fcm/send/a', person);
  });

  it('refuses a subscription for an unknown person', async () => {
    expect(await refusal(subscribe(db(), 'https://fcm.googleapis.com/b', stranger))).toEqual({
      code: '23503',
      constraint: 'push_subscriptions_person_id_people_id_fk',
    });
  });

  it('refuses an endpoint that is not https', async () => {
    expect(await refusal(subscribe(db(), 'http://fcm.googleapis.com/c', person))).toEqual({
      code: '23514',
      constraint: 'push_subscriptions_endpoint_https',
    });
  });
}

function cooldownRules(db: () => AnyDatabase): void {
  it('keeps a window of rank 1 to 3', async () => {
    await cooldown(db(), 1);
    await cooldown(db(), 3);
  });

  it.each([0, 4])('refuses a rank of %i', async (rank) => {
    expect(await refusal(cooldown(db(), rank))).toEqual({
      code: '23514',
      constraint: 'push_cooldowns_rank_known',
    });
  });
}

function contractRules(db: () => AnyDatabase): void {
  it('admits the zulip_topic_linked event contract 12.0.0 adds', async () => {
    await seedEvent(db(), { harnessId, n: 1, name: 'zulip_topic_linked' });
  });

  it('admits a webhook delivery from zulip', async () => {
    await db().execute(sql`INSERT INTO webhook_deliveries (source, delivery_id, received_at)
      VALUES ('zulip', 'zulip:1201', ${atText}::timestamptz)`);
  });
}

function describeTarget(target: DatabaseTarget): void {
  const db = openDatabase(target);
  describe('push_subscriptions hold one browser subscription per endpoint', () =>
    subscriptionRules(db));
  describe('push_cooldowns hold one ranked window per person', () => cooldownRules(db));
  describe('the checks follow contract 12.0.0', () => contractRules(db));
}

describe('the notifier tables', () => {
  declarationRules();
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => describeTarget(target),
  );
});
