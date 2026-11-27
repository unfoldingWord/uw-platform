import { sql } from 'drizzle-orm';
import { exportPKCS8, generateKeyPair } from 'jose';
import { afterAll, describe } from 'vitest';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer, type TestDatabase } from '@uw/db/test-database';
import { seedPerson } from '@uw/db/test-seed';
import {
  describeWorkspaceContract,
  type RecordedEvent,
  type SeededEvent,
} from '@uw/harness/port-contracts/workspace';
import type { SentMail } from '@uw/harness/port-contracts/workspace';
import { personMailOf, putMailbox, subjectKindOf } from '../assistants/google/subjects.ts';
import {
  fakeGoogle,
  type FakeEvent,
  type FakeGoogle,
} from '../assistants/google/testing/fake-google.ts';
import { platformWorkspace, type WorkspaceDeps } from './workspace.ts';

const domain = 'example.org';
const personIds = [
  'c6000000-0000-4000-8000-000000000011',
  'c6000000-0000-4000-8000-000000000012',
  'c6000000-0000-4000-8000-000000000013',
];

let opened: { database: TestDatabase; db: Database } | null = null;

async function fresh(): Promise<Database> {
  if (opened === null) {
    const database = await createMigratedDatabase(testServer ?? '');
    opened = { database, db: createClient(database.connectionString) };
  }
  const ids = sql`(${personIds[0]}, ${personIds[1]}, ${personIds[2]})`;
  const harnessIds = sql`(SELECT id FROM harnesses WHERE person_id IN ${ids})`;
  await opened.db.execute(sql`DELETE FROM assistant_mail_sends WHERE harness_id IN ${harnessIds}`);
  await opened.db.execute(sql`DELETE FROM assistant_mailboxes WHERE person_id IN ${ids}`);
  await opened.db.execute(sql`DELETE FROM harnesses WHERE person_id IN ${ids}`);
  await opened.db.execute(sql`DELETE FROM people WHERE id IN ${ids}`);
  return opened.db;
}

afterAll(async () => {
  await opened?.db.$client.end();
  await opened?.database.drop();
});

function recorded(google: FakeGoogle, event: FakeEvent): RecordedEvent {
  const inserted = google
    .requests()
    .find(
      (request) => request.method === 'POST' && (request.body as FakeEvent | null)?.id === event.id,
    );
  const props = event.extendedProperties?.private ?? {};
  const harnessId = props['uwAssistantHarness'];
  const holdId = props['uwAssistantHold'];
  return {
    eventId: event.id,
    title: event.summary,
    startsAt: new Date(event.start.dateTime ?? ''),
    endsAt: new Date(event.end.dateTime ?? ''),
    attendees: (event.attendees ?? []).map((attendee) => attendee.email),
    visibility: event.visibility === 'private' ? 'private' : 'default',
    notified: inserted !== undefined && inserted.query['sendUpdates'] !== 'none',
    hold: harnessId !== undefined && holdId !== undefined ? { harnessId, holdId } : null,
  };
}

function headerOf(raw: string, name: string): string | null {
  const head = raw.split('\r\n\r\n')[0] ?? '';
  const line = head.split('\r\n').find((each) => each.startsWith(`${name}: `));
  return line === undefined ? null : line.slice(name.length + 2);
}

function listOf(value: string | null): readonly string[] {
  return value === null ? [] : value.split(', ');
}

function bodyOf(raw: string): string {
  const encoded = (raw.split('\r\n\r\n')[1] ?? '').replaceAll('\r\n', '');
  const binary = atob(encoded);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

function mailOf(from: string, raw: string): SentMail {
  return {
    from,
    to: listOf(headerOf(raw, 'To')),
    cc: listOf(headerOf(raw, 'Cc')),
    replyTo: headerOf(raw, 'Reply-To'),
    subject: headerOf(raw, 'Subject') ?? '',
    body: bodyOf(raw),
  };
}

async function addMailbox(db: Database, google: FakeGoogle, mailbox: MailboxSeed): Promise<void> {
  await db.execute(sql`INSERT INTO harnesses (id, key, title, template, jd_area, created_at, person_id)
    VALUES (${mailbox.harnessId}, ${`assistant-${mailbox.personId}`}, 'Assistant', 'assistant',
      '10-19', now(), ${mailbox.personId}) ON CONFLICT DO NOTHING`);
  const at = new Date();
  await putMailbox(db, { ...mailbox, googleUserId: null, status: 'active', at });
  google.addUser(mailbox.address);
}

type MailboxSeed = {
  readonly harnessId: string;
  readonly personId: string;
  readonly address: string;
};

function reached(google: FakeGoogle): readonly string[] {
  return google.requests().flatMap((request) => {
    const items = (request.body as { items?: { id: string }[] } | null)?.items ?? [];
    return [
      ...items.map((item) => item.id),
      ...(request.subject === null ? [] : [request.subject]),
    ];
  });
}

async function depsOn(db: Database, google: FakeGoogle): Promise<WorkspaceDeps> {
  const pair = await generateKeyPair('RS256', { extractable: true });
  google.trust(pair.publicKey);
  const account = {
    clientEmail: 'assistants@uw-platform.iam.gserviceaccount.com',
    privateKey: await exportPKCS8(pair.privateKey),
  };
  return {
    db,
    domain,
    tokens: {
      account,
      fetcher: google.fetch,
      now: () => new Date(),
      lookup: (email) => subjectKindOf(db, email, domain),
      cache: new Map(),
    },
  };
}

function sentMails(google: FakeGoogle, boxes: readonly string[]): readonly SentMail[] {
  return boxes.flatMap((box) => google.gmail.sent(box).map((mail) => mailOf(box, mail.raw)));
}

function eventOf(event: SeededEvent) {
  return {
    summary: event.title,
    start: { dateTime: event.startsAt.toISOString() },
    end: { dateTime: event.endsAt.toISOString() },
    ...(event.description === undefined ? {} : { description: event.description }),
    attendees: (event.attendees ?? []).map((email) => ({ email })),
  };
}

describe.skipIf(!testServer)('DX-3 the Google Workspace adapter on Postgres', () => {
  describeWorkspaceContract('domain-wide delegation, against the recorded-shape fake', async () => {
    const db = await fresh();
    const google = fakeGoogle();
    const workspace = platformWorkspace(await depsOn(db, google));
    let added = 0;
    const boxes: string[] = [];
    const emailOf = async (personId: string) => (await personMailOf(db, personId, domain)) ?? '';
    return {
      workspace,
      outsider: 'someone@elsewhere.example',
      addPerson: async (email) => {
        const id = personIds[added] ?? '';
        added += 1;
        await seedPerson(db, { id, email });
        google.addUser(email);
        return id;
      },
      addEvent: async (personId, event) => google.addEvent(await emailOf(personId), eventOf(event)),
      events: async (personId) =>
        google.events(await emailOf(personId)).map((event) => recorded(google, event)),
      addressesReached: async () => reached(google),
      addMailbox: async (harnessId, personId, address) => {
        boxes.push(address);
        await addMailbox(db, google, { harnessId, personId, address });
      },
      mails: async () => sentMails(google, boxes),
    };
  });
});
