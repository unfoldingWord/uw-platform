import { sql } from 'drizzle-orm';
import { exportPKCS8, generateKeyPair } from 'jose';
import PostalMime from 'postal-mime';
import { afterAll, describe, expect, it } from 'vitest';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer, type TestDatabase } from '@uw/db/test-database';
import { seedPerson } from '@uw/db/test-seed';
import type { AssistantChannel } from '@uw/contracts';
import type { DirectMessage } from '@uw/harness';
import {
  describeDirectMessagesContract,
  emailSample,
} from '@uw/harness/port-contracts/direct-messages';
import { putMailbox, subjectKindOf } from '../assistants/google/subjects.ts';
import { fakeGoogle, type FakeGoogle } from '../assistants/google/testing/fake-google.ts';
import type { TokenDeps } from '../assistants/google/token.ts';
import { sentMessages } from '../assistants/google/mail-sends.ts';
import { emailDirectMessages } from './direct-messages.email.ts';

const owner = 'b5000000-0000-4000-8000-000000000005';
const stranger = 'b5000000-0000-4000-8000-000000000006';
const harnessOf = (personId: string) => `${personId.slice(0, -4)}a${personId.slice(-3)}`;
const domain = 'example.org';
const mailbox = 'barnabas@example.org';
const at = new Date('2026-11-27T09:00:00.000Z');

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
  await opened.db.execute(sql`TRUNCATE assistant_mail_sends, assistant_bindings`);
  await opened.db.execute(sql`DELETE FROM assistant_mailboxes`);
  return opened.db;
}

afterAll(async () => {
  await opened?.db.$client.end();
  await opened?.database.drop();
});

async function tokensFor(google: FakeGoogle, db: Database): Promise<TokenDeps> {
  const pair = await generateKeyPair('RS256', { extractable: true });
  google.trust(pair.publicKey);
  return {
    account: {
      clientEmail: 'assistants@uw-platform.iam.gserviceaccount.com',
      privateKey: await exportPKCS8(pair.privateKey),
    },
    fetcher: google.fetch,
    now: () => new Date(),
    lookup: (email) => subjectKindOf(db, email, domain),
    cache: new Map(),
  };
}

function bindIn(db: Database) {
  return async (personId: string, channel: AssistantChannel, address: string) => {
    await db.execute(sql`INSERT INTO assistant_bindings
        (harness_id, person_id, channel, address, via, bound_at)
      VALUES (${harnessOf(personId)}, ${personId}, ${channel}, ${address}, 'email_match',
        ${at.toISOString()}::timestamptz)`);
  };
}

function deliveredIn(db: Database, google: FakeGoogle) {
  return async (): Promise<readonly DirectMessage[]> => {
    const effects = new Map(
      (await sentMessages(db, harnessOf(owner))).map((row) => [row.gmailMessageId, row.effectId]),
    );
    return Promise.all(
      google.gmail.sent(mailbox).map(async (one) => {
        const mail = await PostalMime.parse(one.raw);
        return {
          requestId: '',
          effectId: effects.get(one.id) ?? '',
          personId: owner,
          channel: 'email' as const,
          replyAddress: mail.to?.[0]?.address ?? '',
          threadKey: one.threadId,
          text: (mail.text ?? '').trim(),
          traceId: '',
          sendBy: at,
        };
      }),
    );
  };
}

const clock = { now: () => new Date() };

async function mailWorld() {
  const db = await shared();
  const google = fakeGoogle();
  google.addUser(mailbox);
  await putMailbox(db, {
    harnessId: harnessOf(owner),
    personId: owner,
    address: mailbox,
    googleUserId: '1001',
    status: 'active',
    at,
  });
  return { db, google, tokens: await tokensFor(google, db) };
}

async function adapterWorld() {
  const { db, google, tokens } = await mailWorld();
  return { db, google, directMessages: emailDirectMessages({ db, tokens, clock }) };
}

describe.skipIf(!testServer)('DX-3 the Gmail direct messages adapter on Postgres', () => {
  describeDirectMessagesContract(
    'the assistant mailbox, against the recorded-shape fake',
    async () => {
      const { db, google, tokens } = await mailWorld();
      return {
        directMessages: emailDirectMessages({ db, tokens, clock }),
        delivered: deliveredIn(db, google),
        bind: bindIn(db),
      };
    },
    emailSample,
  );
});

const message: DirectMessage = {
  requestId: 'b5000000-0000-4000-8000-000000000101',
  effectId: 'b5000000-0000-4000-8000-000000000102',
  personId: owner,
  channel: 'email',
  replyAddress: 'ana@example.org',
  threadKey: null,
  text: 'Done.',
  traceId: 'b5000000-0000-4000-8000-000000000103',
  sendBy: new Date('2100-01-01T00:00:00.000Z'),
};

describe.skipIf(!testServer)('PA-10 the Gmail adapter replies on my thread, at most once', () => {
  it('threads the reply on my mail, marks it automatic and sends it to me alone', async () => {
    const { db, google, directMessages } = await adapterWorld();
    await bindIn(db)(owner, 'email', 'ana@example.org');
    const original = google.gmail.deliver(
      mailbox,
      'From: ana@example.org\nSubject: Plans\nMessage-ID: <plan1@mail.gmail.com>\n\nHold Friday.\n',
      'thread-77',
    );
    expect(await directMessages.send({ ...message, threadKey: original })).toEqual({
      outcome: 'sent',
    });
    const [sent] = google.gmail.sent(mailbox);
    expect(sent?.threadId).toBe('thread-77');
    const mail = await PostalMime.parse(sent?.raw ?? '');
    expect(mail.to).toEqual([{ name: '', address: 'ana@example.org' }]);
    expect(mail.cc).toBeUndefined();
    expect(mail.subject).toBe('Re: Plans');
    expect(mail.inReplyTo).toBe('<plan1@mail.gmail.com>');
    expect(mail.headers.find((header) => header.key === 'auto-submitted')?.value).toBe(
      'auto-replied',
    );
  });

  it('never resends an effect whose send outcome is unknown', async () => {
    const { db, google, directMessages } = await adapterWorld();
    await bindIn(db)(owner, 'email', 'ana@example.org');
    google.failNextAt('/gmail/v1/users/me/messages/send', 503);
    expect(await directMessages.send(message)).toEqual({ outcome: 'dropped' });
    expect(await directMessages.send(message)).toEqual({ outcome: 'dropped' });
    expect(google.gmail.sent(mailbox)).toHaveLength(0);
  });

  it('may send again after Gmail refused the first attempt', async () => {
    const { db, google, directMessages } = await adapterWorld();
    await bindIn(db)(owner, 'email', 'ana@example.org');
    google.failNextAt('/gmail/v1/users/me/messages/send', 400);
    expect(await directMessages.send(message)).toEqual({ outcome: 'dropped' });
    expect(await directMessages.send(message)).toEqual({ outcome: 'sent' });
    expect(google.gmail.sent(mailbox)).toHaveLength(1);
  });

  it('answers not_paired once the mailbox is suspended, and sends nothing', async () => {
    const { db, google, directMessages } = await adapterWorld();
    await bindIn(db)(owner, 'email', 'ana@example.org');
    await db.execute(sql`UPDATE assistant_mailboxes SET status = 'suspended'`);
    expect(await directMessages.send(message)).toEqual({ outcome: 'not_paired' });
    expect(google.requests()).toEqual([]);
  });
});
