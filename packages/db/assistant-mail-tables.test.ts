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
  `00000000-0000-4000-8000-${(0x781000 + n).toString(16).padStart(12, '0')}`;

const person = uid(1);
const personal = uid(3);
const atText = '2026-11-27T09:00:00.000Z';

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

type Cursor = { readonly historyId?: string | null; readonly labelId?: string | null };

function mailbox(db: AnyDatabase, row: Cursor) {
  return db.execute(sql`INSERT INTO assistant_mailboxes
      (harness_id, person_id, address, google_user_id, status, created_at, updated_at,
       history_id, processed_label_id, swept_at)
    VALUES (${personal}, ${person}, 'barnabas@example.org', null, 'active',
      ${atText}::timestamptz, ${atText}::timestamptz, ${row.historyId ?? null},
      ${row.labelId ?? null}, ${atText}::timestamptz)
    ON CONFLICT (harness_id) DO UPDATE SET history_id = excluded.history_id,
      processed_label_id = excluded.processed_label_id`);
}

function send(db: AnyDatabase, effectId: string, status: string, messageId: string | null) {
  const sentAt = messageId === null ? null : atText;
  return db.execute(sql`INSERT INTO assistant_mail_sends
      (effect_id, harness_id, status, gmail_message_id, claimed_at, sent_at)
    VALUES (${effectId}, ${personal}, ${status}, ${messageId}, ${atText}::timestamptz,
      ${sentAt}::timestamptz)`);
}

function openDatabase(target: DatabaseTarget): () => AnyDatabase {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
    await seedPerson(opened.db, { id: person, email: 'mail-person@example.org' });
    await opened.db.execute(sql`INSERT INTO harnesses
        (id, key, title, template, jd_area, created_at, person_id)
      VALUES (${personal}, ${`assistant-${person}`}, 'Assistant', 'assistant', '10-19',
        ${atText}::timestamptz, ${person})`);
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

function cursorRules(db: () => AnyDatabase): void {
  it('keeps a mailbox history id as Gmail digits and a label id of a safe shape', async () => {
    await mailbox(db(), { historyId: '1234567', labelId: 'Label_42' });
    expect(await refusal(mailbox(db(), { historyId: 'abc' }))).toEqual({
      code: '23514',
      constraint: 'assistant_mailboxes_history_id_shape',
    });
    expect(await refusal(mailbox(db(), { labelId: 'Label 42; drop' }))).toEqual({
      code: '23514',
      constraint: 'assistant_mailboxes_label_id_shape',
    });
  });
}

function sendRules(db: () => AnyDatabase): void {
  it('claims a mail send once, and records a Gmail id exactly when it was sent', async () => {
    await send(db(), uid(30), 'sending', null);
    expect(await refusal(send(db(), uid(30), 'sending', null))).toEqual({
      code: '23505',
      constraint: 'assistant_mail_sends_pkey',
    });
    expect(await refusal(send(db(), uid(31), 'sent', null))).toEqual({
      code: '23514',
      constraint: 'assistant_mail_sends_sent_has_message',
    });
    expect(await refusal(send(db(), uid(32), 'queued', null))).toEqual({
      code: '23514',
      constraint: 'assistant_mail_sends_status_known',
    });
    await send(db(), uid(33), 'sent', '18c2f0a1b2c3d4e5');
  });
}

describe('PA-10 the mailbox cursor and the mail send ledger', () => {
  it('declares the mail send ledger internal and never offline', () => {
    expect(declarationOf(schema.assistantMailSends)).toEqual({
      classification: 'internal',
      offlineEligibility: 'never',
    });
  });

  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => {
      const db = openDatabase(target);
      cursorRules(db);
      sendRules(db);
    },
  );
});
