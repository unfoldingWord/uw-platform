import { sql } from 'drizzle-orm';
import { exportPKCS8, generateKeyPair } from 'jose';
import { afterAll, describe } from 'vitest';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer, type TestDatabase } from '@uw/db/test-database';
import { seedPerson } from '@uw/db/test-seed';
import {
  describeWorkspaceContract,
  type RecordedEvent,
} from '@uw/harness/port-contracts/workspace';
import { personMailOf, subjectKindOf } from '../assistants/google/subjects.ts';
import {
  fakeGoogle,
  type FakeEvent,
  type FakeGoogle,
} from '../assistants/google/testing/fake-google.ts';
import { platformWorkspace } from './workspace.ts';

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
  await opened.db.execute(
    sql`DELETE FROM people WHERE id IN (${personIds[0]}, ${personIds[1]}, ${personIds[2]})`,
  );
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

function reached(google: FakeGoogle): readonly string[] {
  return google.requests().flatMap((request) => {
    const items = (request.body as { items?: { id: string }[] } | null)?.items ?? [];
    return [
      ...items.map((item) => item.id),
      ...(request.subject === null ? [] : [request.subject]),
    ];
  });
}

describe.skipIf(!testServer)('DX-3 the Google Workspace adapter on Postgres', () => {
  describeWorkspaceContract('domain-wide delegation, against the recorded-shape fake', async () => {
    const db = await fresh();
    const google = fakeGoogle();
    const pair = await generateKeyPair('RS256', { extractable: true });
    google.trust(pair.publicKey);
    const account = {
      clientEmail: 'assistants@uw-platform.iam.gserviceaccount.com',
      privateKey: await exportPKCS8(pair.privateKey),
    };
    const workspace = platformWorkspace({
      db,
      domain,
      tokens: {
        account,
        fetcher: google.fetch,
        now: () => new Date(),
        lookup: (email) => subjectKindOf(db, email, domain),
        cache: new Map(),
      },
    });
    let added = 0;
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
      addEvent: async (personId, event) =>
        google.addEvent(await emailOf(personId), {
          summary: event.title,
          start: { dateTime: event.startsAt.toISOString() },
          end: { dateTime: event.endsAt.toISOString() },
          ...(event.description === undefined ? {} : { description: event.description }),
          attendees: (event.attendees ?? []).map((email) => ({ email })),
        }),
      events: async (personId) =>
        google.events(await emailOf(personId)).map((event) => recorded(google, event)),
      addressesReached: async () => reached(google),
    };
  });
});
