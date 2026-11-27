import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer, type TestDatabase } from '@uw/db/test-database';
import { seedPerson } from '@uw/db/test-seed';
import type { AssistantChannel } from '@uw/contracts';
import type { DirectMessage } from '@uw/harness';
import { describeDirectMessagesContract } from '@uw/harness/port-contracts/direct-messages';
import { insertBot } from '../assistants/zulip/bots.ts';
import { sha256Hex } from '../assistants/zulip/digest.ts';
import { sealBotKey } from '../credentials/assistant-bot-keys.ts';
import { sentMessages } from '../assistants/zulip/sends.ts';
import {
  FAKE_ZULIP_SITE,
  fakeZulip,
  type FakeZulip,
} from '../assistants/zulip/testing/fake-zulip.ts';
import { memoryDataKeys } from '../credentials/testing/memory-data-keys.ts';
import { systemTimers } from '../timers.ts';
import { platformDirectMessages } from './direct-messages.ts';

const owner = 'b5000000-0000-4000-8000-000000000005';
const stranger = 'b5000000-0000-4000-8000-000000000006';
const harnessOf = (personId: string) => `${personId.slice(0, -4)}a${personId.slice(-3)}`;
const at = new Date('2026-11-26T09:00:00.000Z');

let opened: { database: TestDatabase; db: Database } | null = null;

async function shared(): Promise<Database> {
  if (opened === null) {
    const database = await createMigratedDatabase(testServer ?? '');
    const db = createClient(database.connectionString);
    for (const personId of [owner, stranger]) {
      await seedPerson(db, { id: personId, email: `${personId.slice(-4)}@example.org` });
      await db.execute(sql`INSERT INTO harnesses (id, key, title, template, jd_area, created_at, person_id)
        VALUES (${harnessOf(personId)}, ${`assistant-${personId}`}, 'Assistant', 'assistant',
          '10-19', ${at.toISOString()}::timestamptz, ${personId})`);
    }
    opened = { database, db };
  }
  await opened.db.execute(
    sql`TRUNCATE assistant_zulip_sends, assistant_bindings, assistant_zulip_bots`,
  );
  return opened.db;
}

afterAll(async () => {
  await opened?.db.$client.end();
  await opened?.database.drop();
});

async function seedBot(
  db: Database,
  zulip: FakeZulip,
  keys: Awaited<ReturnType<typeof memoryDataKeys>>,
) {
  const harnessId = harnessOf(owner);
  const response = await zulip.fetch(`${FAKE_ZULIP_SITE}/api/v1/bots`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa('platform-admin@example.org:admin-key-0001')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      full_name: 'barnabas',
      short_name: 'barnabas',
      bot_type: '3',
      payload_url: JSON.stringify('https://ingest.example.org/webhooks/zulip-assistant'),
    }).toString(),
  });
  const created = (await response.json()) as { user_id: number; api_key: string };
  const sealedKey = await sealBotKey(
    keys,
    { harnessId, botUserId: created.user_id },
    created.api_key,
  );
  if (sealedKey === null) throw new Error('the bot key did not seal');
  await insertBot(db, {
    harnessId,
    personId: owner,
    botUserId: created.user_id,
    botEmail: 'barnabas-bot@chat.example.org',
    fullName: 'barnabas',
    sealedKey,
    webhookTokenDigest: await sha256Hex('token'),
    status: 'active',
    createdAt: at,
    updatedAt: at,
  });
}

function bindIn(db: Database) {
  return async (personId: string, channel: AssistantChannel, address: string) => {
    await db.execute(sql`INSERT INTO assistant_bindings
        (harness_id, person_id, channel, address, via, bound_at)
      VALUES (${harnessOf(personId)}, ${personId}, ${channel}, ${address}, 'email_match',
        ${at.toISOString()}::timestamptz)`);
  };
}

function deliveredIn(db: Database, zulip: FakeZulip) {
  return async (): Promise<readonly DirectMessage[]> => {
    const effects = new Map(
      (await sentMessages(db, harnessOf(owner))).map((row) => [row.zulipMessageId, row.effectId]),
    );
    return zulip.messages().map((message) => ({
      requestId: '',
      effectId: effects.get(message.id) ?? '',
      personId: owner,
      channel: 'zulip_dm' as const,
      replyAddress: `zulip:${String(message.to[0])}`,
      threadKey: null,
      text: message.content,
      traceId: '',
      sendBy: at,
    }));
  };
}

describe.skipIf(!testServer)('DX-3 the Zulip direct messages adapter on Postgres', () => {
  describeDirectMessagesContract(
    'one Zulip bot per person, against the recorded-shape fake',
    async () => {
      const db = await shared();
      const zulip = fakeZulip();
      zulip.addUser('ana@example.org', 'Ana', 5005);
      zulip.addUser('ben@example.org', 'Ben', 6006);
      const keys = await memoryDataKeys();
      await seedBot(db, zulip, keys);
      const directMessages = platformDirectMessages({
        db,
        keys,
        site: FAKE_ZULIP_SITE,
        fetcher: zulip.fetch,
        timers: systemTimers,
        clock: { now: () => new Date() },
      });
      return { directMessages, delivered: deliveredIn(db, zulip), bind: bindIn(db) };
    },
  );
});

const message: DirectMessage = {
  requestId: 'b5000000-0000-4000-8000-000000000101',
  effectId: 'b5000000-0000-4000-8000-000000000102',
  personId: owner,
  channel: 'zulip_dm',
  replyAddress: 'zulip:5005',
  threadKey: 'dm',
  text: 'Done.',
  traceId: 'b5000000-0000-4000-8000-000000000103',
  sendBy: new Date('2100-01-01T00:00:00.000Z'),
};

async function adapterWorld(timers = systemTimers) {
  const db = await shared();
  const zulip = fakeZulip();
  zulip.addUser('ana@example.org', 'Ana', 5005);
  const keys = await memoryDataKeys();
  await seedBot(db, zulip, keys);
  await bindIn(db)(owner, 'zulip_dm', 'zulip:5005');
  const directMessages = platformDirectMessages({
    db,
    keys,
    site: FAKE_ZULIP_SITE,
    fetcher: zulip.fetch,
    timers,
    clock: { now: () => new Date() },
  });
  return { db, zulip, directMessages };
}

describe.skipIf(!testServer)('PA-6 the Zulip adapter sends at most once', () => {
  it('never resends an effect whose send outcome is unknown', async () => {
    const { zulip, directMessages } = await adapterWorld({ after: () => Promise.resolve() });
    zulip.hangNext();
    expect(await directMessages.send(message)).toEqual({ outcome: 'dropped' });
    expect(await directMessages.send(message)).toEqual({ outcome: 'dropped' });
    expect(zulip.calls().filter((call) => call === 'POST /api/v1/messages')).toHaveLength(1);
  });

  it('may send again after Zulip refused the first attempt', async () => {
    const { zulip, directMessages } = await adapterWorld();
    zulip.failNext({ status: 400 });
    expect(await directMessages.send(message)).toEqual({ outcome: 'dropped' });
    expect(await directMessages.send(message)).toEqual({ outcome: 'sent' });
    expect(zulip.messages()).toHaveLength(1);
  });

  it('answers not_paired for a deactivated bot and sends nothing', async () => {
    const { db, zulip, directMessages } = await adapterWorld();
    await db.execute(sql`UPDATE assistant_zulip_bots SET status = 'deactivated'`);
    expect(await directMessages.send(message)).toEqual({ outcome: 'not_paired' });
    expect(zulip.calls()).toEqual(['POST /api/v1/bots']);
  });

  it('sends as the bot of the person and to no one else', async () => {
    const { zulip, directMessages } = await adapterWorld();
    expect(await directMessages.send(message)).toEqual({ outcome: 'sent' });
    expect(zulip.messages().map((sent) => [sent.sender, sent.to])).toEqual([
      ['barnabas-bot@chat.example.org', [5005]],
    ]);
  });
});
