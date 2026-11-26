import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { systemPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { seedPerson } from '@uw/db/test-seed';
import { memoryDataKeys } from '../../credentials/testing/memory-data-keys.ts';
import { kernelOn } from '../../testing/kernel.ts';
import { testServer, withAppDatabase } from '../../testing/postgres.ts';
import type { Timers } from '../../timers.ts';
import { zulipAdmin } from './admin.ts';
import { botOfHarness } from './bots.ts';
import { sha256Hex } from './digest.ts';
import { openBotKey } from '../../credentials/assistant-bot-keys.ts';
import { deactivateZulipBot, provisionZulipBot, reactivateZulipBot } from './provision.ts';
import { FAKE_ADMIN, FAKE_ZULIP_SITE, fakeZulip, type FakeZulip } from './testing/fake-zulip.ts';

const person = '00000000-0000-4000-8000-0000000d0601';
const harness = '00000000-0000-4000-8000-0000000d0602';
const at = new Date('2026-11-26T09:00:00.000Z');
const clock = { now: () => at };
const webhookUrl = 'https://ingest.example.org/webhooks/zulip-assistant';
const waits: Timers = { after: () => new Promise<void>(() => undefined) };
const system = systemPrincipal();

async function seeded(db: Database): Promise<void> {
  await seedPerson(db, { id: person, email: 'ana@example.org' });
  await db.execute(sql`INSERT INTO harnesses (id, key, title, template, jd_area, created_at, person_id)
    VALUES (${harness}, ${`assistant-${person}`}, 'Assistant', 'assistant', '10-19',
      ${at.toISOString()}::timestamptz, ${person})`);
}

async function depsOn(db: Database, zulip: FakeZulip) {
  const keys = await memoryDataKeys();
  return {
    keys,
    deps: {
      db,
      kernel: kernelOn(db, clock),
      keys,
      admin: zulipAdmin({ site: FAKE_ZULIP_SITE, ...FAKE_ADMIN }, zulip.fetch, waits),
      webhookUrl,
      clock,
      caller: { actor: system, traceId: crypto.randomUUID(), requestId: null },
    },
  };
}

const request = {
  harnessId: harness,
  personId: person,
  personEmail: 'ana@example.org',
  name: 'barnabas',
};

async function bindingOf(db: Database): Promise<{ address: string; via: string } | undefined> {
  const [row] = await db.execute<{ address: string; via: string }>(
    sql`SELECT address, via FROM assistant_bindings WHERE harness_id = ${harness}`,
  );
  return row;
}

async function createsOneBotPointingAtIngest(db: Database): Promise<void> {
  await seeded(db);
  const zulip = fakeZulip();
  const ana = zulip.addUser('ana@example.org', 'Ana');
  const { deps, keys } = await depsOn(db, zulip);
  const outcome = await provisionZulipBot(deps, request);
  expect(outcome).toEqual({ outcome: 'provisioned', botUserId: 1002, paired: true });
  const [made] = zulip.bots();
  expect(made?.full_name).toBe('barnabas');
  expect(made?.services[0]?.base_url).toBe(webhookUrl);
  const stored = await botOfHarness(db, harness);
  expect(stored).toMatchObject({
    botUserId: 1002,
    botEmail: 'barnabas-bot@chat.example.org',
    status: 'active',
    webhookTokenDigest: await sha256Hex('token-1002'),
  });
  if (stored === null) throw new Error('no bot row');
  expect(JSON.stringify(stored)).not.toContain('bot-key-1002');
  expect(await openBotKey(keys, stored, stored.sealedKey)).toBe('bot-key-1002');
  expect(await bindingOf(db)).toEqual({ address: `zulip:${String(ana)}`, via: 'email_match' });
}

async function isIdempotentAndAdoptsABot(db: Database): Promise<void> {
  await seeded(db);
  const zulip = fakeZulip();
  const { deps } = await depsOn(db, zulip);
  await deps.admin.createBot({
    fullName: 'barnabas',
    shortName: 'barnabas',
    payloadUrl: webhookUrl,
  });
  const first = await provisionZulipBot(deps, request);
  expect(first).toEqual({ outcome: 'provisioned', botUserId: 1001, paired: false });
  const again = await provisionZulipBot(deps, request);
  expect(again).toEqual({ outcome: 'already', botUserId: 1001, paired: false });
  expect(zulip.bots()).toHaveLength(1);
  expect(zulip.calls().filter((call) => call === 'POST /api/v1/bots')).toHaveLength(1);
}

async function recordsNothingWhenZulipLimitsThe(db: Database): Promise<void> {
  await seeded(db);
  const zulip = fakeZulip();
  const { deps } = await depsOn(db, zulip);
  zulip.failNext({ status: 429, headers: { 'retry-after': '60' } });
  expect(await provisionZulipBot(deps, request)).toEqual({
    outcome: 'failed',
    why: 'zulip_rate_limited',
  });
  expect(await botOfHarness(db, harness)).toBeNull();
}

async function deactivatesTheBotWhenTurnedOff(db: Database): Promise<void> {
  await seeded(db);
  const zulip = fakeZulip();
  const { deps } = await depsOn(db, zulip);
  await provisionZulipBot(deps, request);
  expect(await deactivateZulipBot(deps, harness)).toEqual({ outcome: 'deactivated' });
  expect(zulip.bots()[0]?.is_active).toBe(false);
  expect((await botOfHarness(db, harness))?.status).toBe('deactivated');
  expect(await deactivateZulipBot(deps, harness)).toEqual({ outcome: 'deactivated' });
  expect(await reactivateZulipBot(deps, harness)).toEqual({ outcome: 'active' });
  expect(zulip.bots()[0]?.is_active).toBe(true);
  expect((await botOfHarness(db, harness))?.status).toBe('active');
  expect(await deactivateZulipBot(deps, '00000000-0000-4000-8000-0000000d0699')).toEqual({
    outcome: 'failed',
    why: 'no_bot',
  });
}

describe.skipIf(!testServer)('PA-6 provisioning my assistant Zulip bot', () => {
  it('creates one bot pointing at ingest, seals its key, keeps only its token digest and pairs me by email', () =>
    withAppDatabase(createsOneBotPointingAtIngest));

  it('is idempotent, and adopts a bot it made before a lost write', () =>
    withAppDatabase(isIdempotentAndAdoptsABot));

  it('records nothing when Zulip limits the admin key', () =>
    withAppDatabase(recordsNothingWhenZulipLimitsThe));

  it('deactivates the bot when turned off and reactivates it when turned on', () =>
    withAppDatabase(deactivatesTheBotWhenTurnedOff));
});
