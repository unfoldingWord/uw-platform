import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnyDatabase } from './any-database.ts';
import { declarationOf } from './declarations.ts';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import * as schema from './schema.ts';
import { seedPerson } from './test-seed.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

const uid = (n: number) =>
  `00000000-0000-4000-8000-${(0x75a000 + n).toString(16).padStart(12, '0')}`;

const person = uid(1);
const other = uid(2);
const personal = uid(3);
const otherPersonal = uid(4);
const request = uid(5);
const otherRequest = uid(6);
const atText = '2026-11-20T09:00:00.000Z';

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

async function personalHarness(db: AnyDatabase, id: string, personId: string, req: string) {
  await db.execute(sql`INSERT INTO harnesses (id, key, title, template, jd_area, created_at, person_id)
    VALUES (${id}, ${`assistant-${personId}`}, 'Assistant', 'assistant', '10-19',
      ${atText}::timestamptz, ${personId})`);
  await db.execute(sql`INSERT INTO assistant_requests
      (id, harness_id, person_id, channel, external_id, thread_key, reply_address, note,
       untrusted_parts, received_at, recorded_at)
    VALUES (${req}, ${id}, ${personId}, 'zulip_dm', ${req}, 'dm', 'zulip:5005',
      'Remind me', '[]'::jsonb, ${atText}::timestamptz, ${atText}::timestamptz)`);
}

function addEffect(db: AnyDatabase, id: string, harnessId: string, requestId: string) {
  return db.execute(sql`INSERT INTO assistant_effects
      (id, harness_id, request_id, kind, idempotency_key, payload, created_at)
    VALUES (${id}, ${harnessId}, ${requestId}, 'reminder_set', ${`reminder_set:${id}`},
      '{"text":"Call Ana","dueAt":"2027-01-20T09:00:00.000Z"}'::jsonb, ${atText}::timestamptz)`);
}

type ReminderRow = {
  readonly id: string;
  readonly effectId: string;
  readonly status?: string;
  readonly closed?: boolean;
  readonly text?: string;
  readonly harnessId?: string;
  readonly personId?: string;
  readonly requestId?: string;
};

function addReminder(db: AnyDatabase, row: ReminderRow) {
  const closedAt = row.closed === true ? atText : null;
  return db.execute(sql`INSERT INTO assistant_reminders
      (id, harness_id, person_id, request_id, effect_id, text, due_at, status, closed_at,
       created_at)
    VALUES (${row.id}, ${row.harnessId ?? personal}, ${row.personId ?? person},
      ${row.requestId ?? request}, ${row.effectId}, ${row.text ?? 'Call Ana'},
      '2027-01-20T09:00:00.000Z'::timestamptz, ${row.status ?? 'set'},
      ${closedAt}::timestamptz, ${atText}::timestamptz)`);
}

function openDatabase(target: DatabaseTarget): () => AnyDatabase {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
    await seedPerson(opened.db, { id: person, email: 'reminder-person@example.org' });
    await seedPerson(opened.db, { id: other, email: 'reminder-other@example.org' });
    await personalHarness(opened.db, personal, person, request);
    await personalHarness(opened.db, otherPersonal, other, otherRequest);
    for (const n of [20, 21, 22, 23, 24, 25]) await addEffect(opened.db, uid(n), personal, request);
    await addEffect(opened.db, uid(26), otherPersonal, otherRequest);
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

function reminderRules(db: () => AnyDatabase): void {
  it('keeps one reminder per effect', async () => {
    await addReminder(db(), { id: uid(40), effectId: uid(20) });
    expect(await refusal(addReminder(db(), { id: uid(41), effectId: uid(20) }))).toEqual({
      code: '23505',
      constraint: 'assistant_reminders_effect_once',
    });
  });

  it('refuses an unknown status and a status whose closing time disagrees', async () => {
    expect(
      await refusal(
        addReminder(db(), { id: uid(42), effectId: uid(21), status: 'snoozed', closed: true }),
      ),
    ).toEqual({ code: '23514', constraint: 'assistant_reminders_status_known' });
    expect(
      await refusal(addReminder(db(), { id: uid(43), effectId: uid(21), status: 'fired' })),
    ).toEqual({ code: '23514', constraint: 'assistant_reminders_closed_when_done' });
    expect(
      await refusal(addReminder(db(), { id: uid(44), effectId: uid(21), closed: true })),
    ).toEqual({ code: '23514', constraint: 'assistant_reminders_closed_when_done' });
    await addReminder(db(), { id: uid(45), effectId: uid(21), status: 'fired', closed: true });
  });

  it('refuses an empty text and one over five hundred characters', async () => {
    expect(await refusal(addReminder(db(), { id: uid(46), effectId: uid(22), text: '' }))).toEqual({
      code: '23514',
      constraint: 'assistant_reminders_text_length',
    });
    const long = 'x'.repeat(501);
    expect(
      await refusal(addReminder(db(), { id: uid(47), effectId: uid(22), text: long })),
    ).toEqual({ code: '23514', constraint: 'assistant_reminders_text_length' });
  });
}

function crossedRules(db: () => AnyDatabase): void {
  it("refuses a reminder on one personal harness for another harness's request", async () => {
    const crossed = { id: uid(48), effectId: uid(23), requestId: otherRequest };
    expect(await refusal(addReminder(db(), crossed))).toEqual({
      code: '23503',
      constraint: 'assistant_reminders_request_harness_fk',
    });
  });

  it('refuses a reminder whose effect belongs to another personal harness', async () => {
    const crossed = { id: uid(49), effectId: uid(26) };
    expect(await refusal(addReminder(db(), crossed))).toEqual({
      code: '23503',
      constraint: 'assistant_reminders_effect_harness_fk',
    });
  });

  it("refuses a reminder whose person is not the harness's person", async () => {
    const crossed = { id: uid(50), effectId: uid(24), personId: other };
    expect(await refusal(addReminder(db(), crossed))).toEqual({
      code: '23503',
      constraint: 'assistant_reminders_personal_harness_fk',
    });
  });
}

describe('PA-5 the assistant_reminders table', () => {
  it('declares the table restricted and never offline', () => {
    expect(declarationOf(schema.assistantReminders)).toEqual({
      classification: 'restricted',
      offlineEligibility: 'never',
    });
  });

  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => {
      const db = openDatabase(target);
      reminderRules(db);
      crossedRules(db);
    },
  );
});
