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
  `00000000-0000-4000-8000-${(0x76a000 + n).toString(16).padStart(12, '0')}`;

const person = uid(1);
const other = uid(2);
const personal = uid(3);
const otherPersonal = uid(4);
const atText = '2026-11-26T09:00:00.000Z';
const digest = 'a'.repeat(64);

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

function personalHarness(db: AnyDatabase, id: string, personId: string) {
  return db.execute(sql`INSERT INTO harnesses (id, key, title, template, jd_area, created_at, person_id)
    VALUES (${id}, ${`assistant-${personId}`}, 'Assistant', 'assistant', '10-19',
      ${atText}::timestamptz, ${personId})`);
}

type Binding = {
  readonly harnessId?: string;
  readonly personId?: string;
  readonly channel?: string;
  readonly address: string;
  readonly via?: string;
};

function bind(db: AnyDatabase, row: Binding) {
  return db.execute(sql`INSERT INTO assistant_bindings
      (harness_id, person_id, channel, address, via, bound_at)
    VALUES (${row.harnessId ?? personal}, ${row.personId ?? person}, ${row.channel ?? 'zulip_dm'},
      ${row.address}, ${row.via ?? 'email_match'}, ${atText}::timestamptz)`);
}

type Code = { readonly harnessId?: string; readonly digest?: string; readonly attempts?: number };

function code(db: AnyDatabase, row: Code) {
  return db.execute(sql`INSERT INTO assistant_pairing_codes
      (harness_id, person_id, channel, code_digest, expires_at, attempts, created_at)
    VALUES (${row.harnessId ?? personal}, ${person}, 'zulip_dm', ${row.digest ?? digest},
      ${atText}::timestamptz, ${row.attempts ?? 0}, ${atText}::timestamptz)`);
}

type Bot = {
  readonly harnessId: string;
  readonly personId: string;
  readonly botUserId: number;
  readonly botEmail: string;
  readonly status?: string;
  readonly digest?: string;
};

function bot(db: AnyDatabase, row: Bot) {
  return db.execute(sql`INSERT INTO assistant_zulip_bots
      (harness_id, person_id, bot_user_id, bot_email, full_name, key_cipher, key_ciphertext,
       key_nonce, key_wrapped, key_id, webhook_token_digest, status, created_at, updated_at)
    VALUES (${row.harnessId}, ${row.personId}, ${row.botUserId}, ${row.botEmail}, 'barnabas',
      'aes-256-gcm', 'c2VhbGVk', 'bm9uY2U=', 'd3JhcHBlZA==', 'kms-key', ${row.digest ?? digest},
      ${row.status ?? 'active'}, ${atText}::timestamptz, ${atText}::timestamptz)`);
}

function send(db: AnyDatabase, effectId: string, status: string, messageId: number | null) {
  const sentAt = messageId === null ? null : atText;
  return db.execute(sql`INSERT INTO assistant_zulip_sends
      (effect_id, harness_id, status, zulip_message_id, claimed_at, sent_at)
    VALUES (${effectId}, ${personal}, ${status}, ${messageId}, ${atText}::timestamptz,
      ${sentAt}::timestamptz)`);
}

function openDatabase(target: DatabaseTarget): () => AnyDatabase {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
    await seedPerson(opened.db, { id: person, email: 'zulip-person@example.org' });
    await seedPerson(opened.db, { id: other, email: 'zulip-other@example.org' });
    await personalHarness(opened.db, personal, person);
    await personalHarness(opened.db, otherPersonal, other);
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

function bindingRules(db: () => AnyDatabase): void {
  it('keeps one binding per channel and gives an address to one assistant', async () => {
    await bind(db(), { address: 'zulip:5005' });
    expect(await refusal(bind(db(), { address: 'zulip:5006' }))).toEqual({
      code: '23505',
      constraint: 'assistant_bindings_pk',
    });
    const taken = { harnessId: otherPersonal, personId: other, address: 'zulip:5005' };
    expect(await refusal(bind(db(), taken))).toEqual({
      code: '23505',
      constraint: 'assistant_bindings_address_once',
    });
  });

  it('refuses a Zulip address that is not a user id, and an unknown way of pairing', async () => {
    const malformed = { harnessId: otherPersonal, personId: other, address: 'ana@example.org' };
    expect(await refusal(bind(db(), malformed))).toEqual({
      code: '23514',
      constraint: 'assistant_bindings_zulip_address',
    });
    const unknown = { harnessId: otherPersonal, personId: other, address: 'zulip:7', via: 'guess' };
    expect(await refusal(bind(db(), unknown))).toEqual({
      code: '23514',
      constraint: 'assistant_bindings_via_known',
    });
  });

  it("refuses a binding whose person is not the harness's person", async () => {
    const crossed = { harnessId: otherPersonal, address: 'zulip:8008' };
    expect(await refusal(bind(db(), crossed))).toEqual({
      code: '23503',
      constraint: 'assistant_bindings_personal_harness_fk',
    });
  });
}

function codeRules(db: () => AnyDatabase): void {
  it('keeps one live code per channel, as a digest, with at most five attempts', async () => {
    await code(db(), {});
    expect(await refusal(code(db(), {}))).toEqual({
      code: '23505',
      constraint: 'assistant_pairing_codes_pk',
    });
    expect(await refusal(code(db(), { harnessId: otherPersonal, digest: 'K7M2Q9XR' }))).toEqual({
      code: '23514',
      constraint: 'assistant_pairing_codes_digest_shape',
    });
    expect(await refusal(code(db(), { harnessId: otherPersonal, attempts: 6 }))).toEqual({
      code: '23514',
      constraint: 'assistant_pairing_codes_attempts_bounded',
    });
  });
}

function botRules(db: () => AnyDatabase): void {
  it('keeps one bot per assistant, each Zulip bot once, and a known status', async () => {
    const first = { harnessId: personal, personId: person, botUserId: 9001, botEmail: 'a-bot@z' };
    await bot(db(), first);
    expect(await refusal(bot(db(), { ...first, botUserId: 9002, botEmail: 'b-bot@z' }))).toEqual({
      code: '23505',
      constraint: 'assistant_zulip_bots_pkey',
    });
    const reused = { harnessId: otherPersonal, personId: other, botUserId: 9001, botEmail: 'c@z' };
    expect(await refusal(bot(db(), reused))).toEqual({
      code: '23505',
      constraint: 'assistant_zulip_bots_user_once',
    });
    const paused = { ...reused, botUserId: 9003, status: 'paused' };
    expect(await refusal(bot(db(), paused))).toEqual({
      code: '23514',
      constraint: 'assistant_zulip_bots_status_known',
    });
    const raw = { ...reused, botUserId: 9003, digest: 'token' };
    expect(await refusal(bot(db(), raw))).toEqual({
      code: '23514',
      constraint: 'assistant_zulip_bots_token_digest_shape',
    });
  });
}

function sendRules(db: () => AnyDatabase): void {
  it('claims a send once, and records a message id exactly when it was sent', async () => {
    await send(db(), uid(30), 'sending', null);
    expect(await refusal(send(db(), uid(30), 'sending', null))).toEqual({
      code: '23505',
      constraint: 'assistant_zulip_sends_pkey',
    });
    expect(await refusal(send(db(), uid(31), 'sent', null))).toEqual({
      code: '23514',
      constraint: 'assistant_zulip_sends_sent_has_message',
    });
    expect(await refusal(send(db(), uid(32), 'sending', 77))).toEqual({
      code: '23514',
      constraint: 'assistant_zulip_sends_sent_has_message',
    });
    await send(db(), uid(33), 'sent', 77);
  });
}

describe('PA-6 the assistant binding, pairing and Zulip bot tables', () => {
  it('declares the person-held tables restricted and the send ledger internal', () => {
    for (const table of [
      schema.assistantBindings,
      schema.assistantPairingCodes,
      schema.assistantZulipBots,
    ]) {
      expect(declarationOf(table)).toEqual({
        classification: 'restricted',
        offlineEligibility: 'never',
      });
    }
    expect(declarationOf(schema.assistantZulipSends)).toEqual({
      classification: 'internal',
      offlineEligibility: 'never',
    });
  });

  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => {
      const db = openDatabase(target);
      bindingRules(db);
      codeRules(db);
      botRules(db);
      sendRules(db);
    },
  );
});
