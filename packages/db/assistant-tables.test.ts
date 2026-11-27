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

const person = '00000000-0000-4000-8000-000000071a01';
const other = '00000000-0000-4000-8000-000000071a02';
const personal = '00000000-0000-4000-8000-000000071b01';
const otherPersonal = '00000000-0000-4000-8000-000000071b02';
const request = '00000000-0000-4000-8000-000000071c01';
const otherRequest = '00000000-0000-4000-8000-000000071c02';
const trace = '00000000-0000-4000-8000-000000071e01';
const atText = '2026-11-20T09:00:00.000Z';

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

type HarnessRow = {
  readonly id: string;
  readonly key: string;
  readonly template: string;
  readonly personId: string | null;
};

function addHarness(db: AnyDatabase, row: HarnessRow) {
  return db.execute(sql`INSERT INTO harnesses (id, key, title, template, jd_area, created_at, person_id)
    VALUES (${row.id}, ${row.key}, ${row.key}, ${row.template}, '90-99', ${atText}::timestamptz,
      ${row.personId})`);
}

type RequestRow = {
  readonly id: string;
  readonly externalId: string;
  readonly channel?: string;
  readonly parts?: string;
  readonly threadKey?: string | null;
  readonly harnessId?: string;
  readonly personId?: string;
};

function addRequest(db: AnyDatabase, row: RequestRow) {
  const threadKey = row.threadKey === undefined ? 'dm' : row.threadKey;
  return db.execute(sql`INSERT INTO assistant_requests
      (id, harness_id, person_id, channel, external_id, thread_key, reply_address, note,
       untrusted_parts, received_at, recorded_at)
    VALUES (${row.id}, ${row.harnessId ?? personal}, ${row.personId ?? person},
      ${row.channel ?? 'zulip_dm'}, ${row.externalId}, ${threadKey}, 'zulip:5005',
      'What is on my schedule today?', ${row.parts ?? '[]'}::jsonb,
      ${atText}::timestamptz, ${atText}::timestamptz)`);
}

type EffectRow = {
  readonly id: string;
  readonly kind: string;
  readonly key: string;
  readonly harnessId?: string;
  readonly requestId?: string;
};

function addEffect(db: AnyDatabase, row: EffectRow) {
  return db.execute(sql`INSERT INTO assistant_effects
      (id, harness_id, request_id, kind, idempotency_key, payload, created_at)
    VALUES (${row.id}, ${row.harnessId ?? personal}, ${row.requestId ?? request}, ${row.kind},
      ${row.key}, '{"text":"Done."}'::jsonb, ${atText}::timestamptz)`);
}

function addSettings(db: AnyDatabase, personId: string) {
  return db.execute(sql`INSERT INTO assistant_settings
      (harness_id, person_id, display_name, instructions_md, timezone, version, updated_at)
    VALUES (${personal}, ${personId}, 'Ada', '', 'Africa/Nairobi', 1, ${atText}::timestamptz)`);
}

function openDatabase(target: DatabaseTarget): () => AnyDatabase {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
    await seedPerson(opened.db, { id: person, email: 'assistant-person@example.org' });
    await seedPerson(opened.db, { id: other, email: 'assistant-other@example.org' });
    await addHarness(opened.db, {
      id: personal,
      key: `assistant-${person}`,
      template: 'assistant',
      personId: person,
    });
    await addHarness(opened.db, {
      id: otherPersonal,
      key: `assistant-${other}`,
      template: 'assistant',
      personId: other,
    });
    await addRequest(opened.db, { id: request, externalId: '101' });
    await addRequest(opened.db, {
      id: otherRequest,
      externalId: '201',
      harnessId: otherPersonal,
      personId: other,
    });
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

const uid = (n: number) =>
  `00000000-0000-4000-8000-${(0x71f000 + n).toString(16).padStart(12, '0')}`;

function harnessRules(db: () => AnyDatabase): void {
  it('refuses a person on a harness that is not an assistant, and an assistant with no person', async () => {
    const workflow = {
      id: uid(1),
      key: 'software-personal',
      template: 'software',
      personId: other,
    };
    const orphan = { id: uid(2), key: 'assistant-orphan', template: 'assistant', personId: null };
    const expected = { code: '23514', constraint: 'harnesses_personal_template' };
    expect(await refusal(addHarness(db(), workflow))).toEqual(expected);
    expect(await refusal(addHarness(db(), orphan))).toEqual(expected);
  });

  it('refuses a second assistant for one person', async () => {
    const twin = { id: uid(3), key: 'assistant-twin', template: 'assistant', personId: person };
    expect(await refusal(addHarness(db(), twin))).toEqual({
      code: '23505',
      constraint: 'harnesses_one_assistant_per_person',
    });
  });

  it('accepts an assist delegation and an assistant event, since both closed sets widened', async () => {
    await db().execute(sql`INSERT INTO delegations
        (id, person_id, persona, harness_id, capability, granted_at, expires_at, trace_id)
      VALUES (${uid(4)}, ${person}, ${`agent:assistant-${person}`}, ${personal}, 'assist',
        ${atText}::timestamptz, ${atText}::timestamptz + interval '90 days', ${trace})`);
    await db().execute(sql`INSERT INTO harness_events
        (id, harness_id, name, actor, evidence, trace_id, at)
      VALUES (${uid(5)}, ${personal}, 'assistant_request_recorded', 'agent:ingest',
        ${JSON.stringify({ requestId: request, channel: 'zulip_dm' })}::jsonb, ${trace},
        ${atText}::timestamptz)`);
  });
}

function requestRules(db: () => AnyDatabase): void {
  it('refuses a second request with the same channel and external id', async () => {
    expect(await refusal(addRequest(db(), { id: uid(10), externalId: '101' }))).toEqual({
      code: '23505',
      constraint: 'assistant_requests_external_once',
    });
    await addRequest(db(), { id: uid(11), externalId: '101', channel: 'email' });
  });

  it('refuses an unknown channel and more than twenty untrusted parts', async () => {
    const parts = JSON.stringify(
      Array.from({ length: 21 }, () => ({ source: 'chat_quote', text: 'x' })),
    );
    expect(
      await refusal(addRequest(db(), { id: uid(12), externalId: '102', channel: 'sms' })),
    ).toEqual({ code: '23514', constraint: 'assistant_requests_channel_known' });
    expect(await refusal(addRequest(db(), { id: uid(13), externalId: '103', parts }))).toEqual({
      code: '23514',
      constraint: 'assistant_requests_untrusted_parts_bounded',
    });
  });

  it('refuses an empty thread key and keeps an unthreaded request as null', async () => {
    expect(
      await refusal(addRequest(db(), { id: uid(14), externalId: '104', threadKey: '' })),
    ).toEqual({ code: '23514', constraint: 'assistant_requests_thread_key_length' });
    await addRequest(db(), { id: uid(15), externalId: '105', threadKey: null });
  });
}

function effectRules(db: () => AnyDatabase): void {
  it('records a reply once per key', async () => {
    const reply = { kind: 'reply_to_requester', key: `reply:${request}` };
    await addEffect(db(), { id: uid(20), ...reply });
    expect(await refusal(addEffect(db(), { id: uid(21), ...reply }))).toEqual({
      code: '23505',
      constraint: 'assistant_effects_key_once',
    });
  });

  it('refuses an effect outside the closed low-risk set without a decided proposal', async () => {
    for (const kind of ['email_to_others', 'email_sent']) {
      const effect = { id: uid(22), kind, key: `${kind}:1` };
      expect(await refusal(addEffect(db(), effect))).toEqual({
        code: '23514',
        constraint: 'assistant_effects_direct_or_decided',
      });
    }
  });

  it("refuses an effect on one personal harness for another personal harness's request", async () => {
    const crossed = {
      id: uid(23),
      kind: 'reply_to_requester',
      key: `reply:${otherRequest}`,
      requestId: otherRequest,
    };
    expect(await refusal(addEffect(db(), crossed))).toEqual({
      code: '23503',
      constraint: 'assistant_effects_request_harness_fk',
    });
    await addEffect(db(), { ...crossed, harnessId: otherPersonal });
  });
}

function settingsRules(db: () => AnyDatabase): void {
  it("refuses settings whose person is not the harness's person, and keeps the person's own", async () => {
    expect(await refusal(addSettings(db(), other))).toEqual({
      code: '23503',
      constraint: 'assistant_settings_personal_harness_fk',
    });
    await addSettings(db(), person);
  });
}

function describeTarget(target: DatabaseTarget): void {
  const db = openDatabase(target);
  describe('harnesses name one person only on an assistant harness', () => harnessRules(db));
  describe('assistant_requests are once per channel and external id', () => requestRules(db));
  describe('assistant_effects hold only the closed low-risk set', () => effectRules(db));
  describe("assistant_settings belong to the harness's own person", () => settingsRules(db));
}

describe('PA-1 PA-4 the assistant tables', () => {
  it('declares the three tables restricted and never offline', () => {
    const declared = [
      schema.assistantSettings,
      schema.assistantRequests,
      schema.assistantEffects,
    ].map(declarationOf);
    expect(declared).toEqual(
      Array.from({ length: 3 }, () => ({
        classification: 'restricted',
        offlineEligibility: 'never',
      })),
    );
  });

  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => describeTarget(target),
  );
});
