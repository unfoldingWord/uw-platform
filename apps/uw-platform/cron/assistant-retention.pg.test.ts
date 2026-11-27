import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase } from '@uw/db/test-database';
import { seedPerson } from '@uw/db/test-seed';
import { directMessagesOf } from '../assistants/direct-messages.ts';
import { testServer } from '../testing/postgres.ts';
import type { CronDeps } from './job.ts';
import { redactAssistantHistoryJob } from './assistant-retention.ts';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2027-12-01T03:17:00.000Z');
const personId = '00000000-0000-4000-8000-0000000e3901';
const harnessId = '00000000-0000-4000-8000-0000000e3902';

type Line = Record<string, unknown>;

function deps(lines: Line[]): CronDeps {
  return {
    now: () => now,
    fetch: () => Promise.reject(new Error('the retention sends no request')),
    sink: (line) => lines.push(JSON.parse(line) as Line),
    newId: () => randomUUID(),
    commit: 'c',
    engines: { fetch: () => Promise.reject(new Error('the retention reads no spend')) },
    directMessages: directMessagesOf,
  };
}

async function seed(db: Database): Promise<void> {
  await seedPerson(db, { id: personId, email: 'kept.year@unfoldingword.org' });
  await db.execute(sql`INSERT INTO harnesses (id, key, title, template, jd_area, created_at, person_id)
    VALUES (${harnessId}, ${`assistant-${personId}`}, '10.51 Kept', 'assistant', '10-19',
      ${new Date(now.getTime() - 500 * DAY).toISOString()}::timestamptz, ${personId})`);
}

async function ask(db: Database, daysAgo: number, note: string): Promise<string> {
  const id = randomUUID();
  const when = new Date(now.getTime() - daysAgo * DAY).toISOString();
  await db.execute(sql`INSERT INTO assistant_requests
      (id, harness_id, person_id, channel, external_id, thread_key, reply_address, note,
       untrusted_parts, received_at, recorded_at)
    VALUES (${id}, ${harnessId}, ${personId}, 'zulip_dm', ${id}, 'dm', 'zulip:5005', ${note},
      '[{"source":"chat_quote","text":"quoted"}]'::jsonb, ${when}::timestamptz,
      ${when}::timestamptz)`);
  await db.execute(sql`INSERT INTO assistant_effects
      (id, harness_id, request_id, kind, idempotency_key, payload, created_at)
    VALUES (${randomUUID()}, ${harnessId}, ${id}, 'reply_to_requester', ${`reply:${id}`},
      '{"text":"An answer"}'::jsonb, ${when}::timestamptz)`);
  return id;
}

async function redactsTheOldYear(): Promise<void> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  try {
    await seed(db);
    const old = await ask(db, 366, 'An old question');
    const kept = await ask(db, 364, 'A newer question');
    const lines: Line[] = [];
    const env = { HYPERDRIVE: { connectionString: database.connectionString } };
    await redactAssistantHistoryJob(env, deps(lines));
    const rows = await db.execute<{ id: string; note: string; payload: unknown }>(
      sql`SELECT r.id, r.note, e.payload FROM assistant_requests r
        JOIN assistant_effects e ON e.request_id = r.id ORDER BY r.recorded_at`,
    );
    expect(rows).toEqual([
      { id: old, note: '', payload: {} },
      { id: kept, note: 'A newer question', payload: { text: 'An answer' } },
    ]);
    const events = await db.execute<{ evidence: unknown; actor: string }>(
      sql`SELECT evidence, actor FROM harness_events WHERE name = 'assistant_history_redacted'`,
    );
    expect(events).toEqual([
      { evidence: { why: 'retention', requests: 1 }, actor: 'agent:system' },
    ]);
    expect(lines).toEqual([
      expect.objectContaining({ outcome: 'history_redacted', requests: 1, done: true }),
    ]);
  } finally {
    await db.$client.end();
    await database.drop();
  }
}

describe.skipIf(!testServer)('PA-15 the nightly assistant history retention', () => {
  it('redacts request text and replies older than 365 days and keeps the content-free event', () =>
    redactsTheOldYear());
});
