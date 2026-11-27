import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnyDatabase } from './any-database.ts';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { seedPerson } from './test-seed.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

const uid = (n: number) =>
  `00000000-0000-4000-8000-${(0x79a000 + n).toString(16).padStart(12, '0')}`;

const person = uid(1);
const personal = uid(3);
const request = uid(5);
const atText = '2026-11-20T09:00:00.000Z';

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

async function seed(db: AnyDatabase): Promise<void> {
  await seedPerson(db, { id: person, email: 'history-person@example.org' });
  await db.execute(sql`INSERT INTO harnesses (id, key, title, template, jd_area, created_at, person_id)
    VALUES (${personal}, ${`assistant-${person}`}, 'Assistant', 'assistant', '10-19',
      ${atText}::timestamptz, ${person})`);
  await db.execute(sql`INSERT INTO assistant_requests
      (id, harness_id, person_id, channel, external_id, thread_key, reply_address, note,
       untrusted_parts, received_at, recorded_at)
    VALUES (${request}, ${personal}, ${person}, 'zulip_dm', ${request}, 'dm', 'zulip:5005',
      'Remind me', '[{"source":"chat_quote","text":"q"}]'::jsonb, ${atText}::timestamptz,
      ${atText}::timestamptz)`);
  for (const n of [10, 11, 12]) {
    await db.execute(sql`INSERT INTO assistant_effects
        (id, harness_id, request_id, kind, idempotency_key, payload, created_at)
      VALUES (${uid(n)}, ${personal}, ${request}, 'calendar_hold_added', ${`k:${String(n)}`},
        '{"title":"Focus"}'::jsonb, ${atText}::timestamptz)`);
  }
}

function openDatabase(target: DatabaseTarget): () => AnyDatabase {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
    await seed(opened.db);
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

function addReminder(db: AnyDatabase, status: string, text: string, redacted: boolean) {
  const closed = status === 'set' ? null : atText;
  return db.execute(sql`INSERT INTO assistant_reminders
      (id, harness_id, person_id, request_id, effect_id, text, due_at, status, closed_at,
       created_at, redacted_at)
    VALUES (${uid(20)}, ${personal}, ${person}, ${request}, ${uid(10)}, ${text},
      '2027-01-01T09:00:00.000Z'::timestamptz, ${status}, ${closed}::timestamptz,
      ${atText}::timestamptz, ${redacted ? atText : null}::timestamptz)`);
}

function addHold(db: AnyDatabase, row: { status: string; title: string; redacted: boolean }) {
  const released = row.status === 'released' ? atText : null;
  return db.execute(sql`INSERT INTO assistant_calendar_holds
      (id, harness_id, person_id, event_id, title, starts_at, ends_at, status,
       released_effect_id, released_at, created_at, redacted_at)
    VALUES (${uid(11)}, ${personal}, ${person}, ${uid(11).replaceAll('-', '')}, ${row.title},
      '2027-01-20T09:00:00.000Z'::timestamptz, '2027-01-20T10:00:00.000Z'::timestamptz,
      ${row.status}, NULL, ${released}::timestamptz, ${atText}::timestamptz,
      ${row.redacted ? atText : null}::timestamptz)`);
}

function requestRules(db: () => AnyDatabase): void {
  it('keeps a redacted request with no note and no untrusted parts', async () => {
    expect(
      await refusal(
        db().execute(
          sql`UPDATE assistant_requests SET redacted_at = ${atText}::timestamptz WHERE id = ${request}`,
        ),
      ),
    ).toEqual({ code: '23514', constraint: 'assistant_requests_redacted_empty' });
    await db().execute(sql`UPDATE assistant_requests SET redacted_at = ${atText}::timestamptz,
      note = '', untrusted_parts = '[]'::jsonb WHERE id = ${request}`);
  });

  it('keeps a redacted effect with an empty payload', async () => {
    expect(
      await refusal(
        db().execute(
          sql`UPDATE assistant_effects SET redacted_at = ${atText}::timestamptz WHERE id = ${uid(12)}`,
        ),
      ),
    ).toEqual({ code: '23514', constraint: 'assistant_effects_redacted_empty' });
    await db().execute(sql`UPDATE assistant_effects SET redacted_at = ${atText}::timestamptz,
      payload = '{}'::jsonb WHERE id = ${uid(12)}`);
  });
}

function reminderAndHoldRules(db: () => AnyDatabase): void {
  it('redacts only a closed reminder, and only to empty text', async () => {
    expect(await refusal(addReminder(db(), 'set', '', true))).toEqual({
      code: '23514',
      constraint: 'assistant_reminders_text_length',
    });
    expect(await refusal(addReminder(db(), 'fired', 'Call', true))).toEqual({
      code: '23514',
      constraint: 'assistant_reminders_text_length',
    });
    await addReminder(db(), 'fired', '', true);
  });

  it('lets the person release a hold with no releasing effect, and redacts its title', async () => {
    expect(
      await refusal(addHold(db(), { status: 'held', title: 'Focus', redacted: true })),
    ).toEqual({ code: '23514', constraint: 'assistant_calendar_holds_title_length' });
    await addHold(db(), { status: 'released', title: '', redacted: true });
  });
}

describe('PA-15 the redaction columns', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => {
      const db = openDatabase(target);
      requestRules(db);
      reminderAndHoldRules(db);
    },
  );
});
