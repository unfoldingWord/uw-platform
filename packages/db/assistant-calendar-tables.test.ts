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
  `00000000-0000-4000-8000-${(0x78a000 + n).toString(16).padStart(12, '0')}`;

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
      'Hold Friday', '[]'::jsonb, ${atText}::timestamptz, ${atText}::timestamptz)`);
}

function addEffect(db: AnyDatabase, id: string, harnessId: string, requestId: string) {
  return db.execute(sql`INSERT INTO assistant_effects
      (id, harness_id, request_id, kind, idempotency_key, payload, created_at)
    VALUES (${id}, ${harnessId}, ${requestId}, 'calendar_hold_added', ${`hold:${id}`},
      '{}'::jsonb, ${atText}::timestamptz)`);
}

type HoldRow = {
  readonly id: string;
  readonly harnessId?: string;
  readonly personId?: string;
  readonly eventId?: string;
  readonly title?: string;
  readonly hours?: number;
  readonly status?: string;
  readonly releasedEffectId?: string | null;
  readonly releasedAt?: string | null;
};

function addHold(db: AnyDatabase, row: HoldRow) {
  const eventId = row.eventId ?? row.id.replaceAll('-', '');
  const ends = new Date(Date.parse('2027-01-20T09:00:00.000Z') + (row.hours ?? 1) * 3_600_000);
  return db.execute(sql`INSERT INTO assistant_calendar_holds
      (id, harness_id, person_id, event_id, title, starts_at, ends_at, status,
       released_effect_id, released_at, created_at)
    VALUES (${row.id}, ${row.harnessId ?? personal}, ${row.personId ?? person}, ${eventId},
      ${row.title ?? 'Focus'}, '2027-01-20T09:00:00.000Z'::timestamptz,
      ${ends.toISOString()}::timestamptz, ${row.status ?? 'held'},
      ${row.releasedEffectId ?? null}::uuid, ${row.releasedAt ?? null}::timestamptz,
      ${atText}::timestamptz)`);
}

function addMailbox(db: AnyDatabase, harnessId: string, personId: string, address: string) {
  return db.execute(sql`INSERT INTO assistant_mailboxes
      (harness_id, person_id, address, status, created_at, updated_at)
    VALUES (${harnessId}, ${personId}, ${address}, 'active', ${atText}::timestamptz,
      ${atText}::timestamptz)`);
}

function openDatabase(target: DatabaseTarget): () => AnyDatabase {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
    await seedPerson(opened.db, { id: person, email: 'hold-person@example.org' });
    await seedPerson(opened.db, { id: other, email: 'hold-other@example.org' });
    await personalHarness(opened.db, personal, person, request);
    await personalHarness(opened.db, otherPersonal, other, otherRequest);
    for (const n of [20, 21, 22, 23, 24, 25, 26, 27]) {
      await addEffect(opened.db, uid(n), personal, request);
    }
    await addEffect(opened.db, uid(30), otherPersonal, otherRequest);
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

function holdRules(db: () => AnyDatabase): void {
  it('keeps a hold to its own effect on its own personal harness', async () => {
    await addHold(db(), { id: uid(20) });
    expect(await refusal(addHold(db(), { id: uid(30) }))).toEqual({
      code: '23503',
      constraint: 'assistant_calendar_holds_effect_harness_fk',
    });
    expect(await refusal(addHold(db(), { id: uid(21), personId: other }))).toEqual({
      code: '23503',
      constraint: 'assistant_calendar_holds_personal_harness_fk',
    });
  });

  it('refuses a hold longer than a day and an empty title', async () => {
    expect(await refusal(addHold(db(), { id: uid(22), hours: 25 }))).toEqual({
      code: '23514',
      constraint: 'assistant_calendar_holds_at_most_a_day',
    });
    expect(await refusal(addHold(db(), { id: uid(22), hours: 0 }))).toEqual({
      code: '23514',
      constraint: 'assistant_calendar_holds_at_most_a_day',
    });
    expect(await refusal(addHold(db(), { id: uid(22), title: '' }))).toEqual({
      code: '23514',
      constraint: 'assistant_calendar_holds_title_length',
    });
  });
}

function holdShapeRules(db: () => AnyDatabase): void {
  it('refuses an event id Google could not have and a second hold on one event', async () => {
    expect(await refusal(addHold(db(), { id: uid(23), eventId: 'Not-An-Id' }))).toEqual({
      code: '23514',
      constraint: 'assistant_calendar_holds_event_id_shape',
    });
    expect(
      await refusal(addHold(db(), { id: uid(23), eventId: uid(20).replaceAll('-', '') })),
    ).toEqual({ code: '23505', constraint: 'assistant_calendar_holds_event_once' });
  });

  it('records a release only with its effect and its time', async () => {
    expect(await refusal(addHold(db(), { id: uid(24), status: 'released' }))).toEqual({
      code: '23514',
      constraint: 'assistant_calendar_holds_released_when_done',
    });
    expect(await refusal(addHold(db(), { id: uid(24), status: 'tentative' }))).toEqual({
      code: '23514',
      constraint: 'assistant_calendar_holds_status_known',
    });
    await addHold(db(), {
      id: uid(24),
      status: 'released',
      releasedEffectId: uid(25),
      releasedAt: atText,
    });
  });
}

function mailboxRules(db: () => AnyDatabase): void {
  it('keeps one lowercase mailbox address per personal harness', async () => {
    expect(await refusal(addMailbox(db(), personal, person, 'Barnabas@example.org'))).toEqual({
      code: '23514',
      constraint: 'assistant_mailboxes_address_shape',
    });
    await addMailbox(db(), personal, person, 'barnabas@example.org');
    expect(await refusal(addMailbox(db(), otherPersonal, other, 'barnabas@example.org'))).toEqual({
      code: '23505',
      constraint: 'assistant_mailboxes_address_once',
    });
    expect(await refusal(addMailbox(db(), otherPersonal, person, 'silas@example.org'))).toEqual({
      code: '23503',
      constraint: 'assistant_mailboxes_personal_harness_fk',
    });
  });
}

describe('PA-8 the calendar hold and mailbox tables', () => {
  it('declares holds restricted and mailboxes internal, both never offline', () => {
    expect(declarationOf(schema.assistantCalendarHolds)).toEqual({
      classification: 'restricted',
      offlineEligibility: 'never',
    });
    expect(declarationOf(schema.assistantMailboxes)).toEqual({
      classification: 'internal',
      offlineEligibility: 'never',
    });
  });

  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => {
      const db = openDatabase(target);
      holdRules(db);
      holdShapeRules(db);
      mailboxRules(db);
    },
  );
});
