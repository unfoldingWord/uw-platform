import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { post } from '../../testing/commands.ts';
import { testServer, withAppDatabase } from '../../testing/postgres.ts';

const ANA = 'ana.my.assistant@unfoldingword.org';
const BEN = 'ben.my.assistant@unfoldingword.org';
const anaId = '00000000-0000-4000-8000-0000000e3701';
const benId = '00000000-0000-4000-8000-0000000e3702';
const at = '2026-11-20T09:00:00.000Z';

async function staff(db: Database, id: string, email: string): Promise<void> {
  await seedPerson(db, { id, email });
  await seedGrant(db, {
    id: randomUUID(),
    personId: id,
    role: 'viewer',
    scopeKind: 'jd_area',
    scopeArea: '30-39',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
}

function command(db: Database, email: string, body: Record<string, unknown>) {
  return post(db, email, `/api/assistant/commands/${String(body['command'])}`, {
    requestId: randomUUID(),
    ...body,
  });
}

async function turnedOn(db: Database): Promise<string> {
  await staff(db, anaId, ANA);
  await staff(db, benId, BEN);
  const on = await command(db, ANA, { command: 'enable_assistant', name: 'silas' });
  expect(on.body).toMatchObject({ status: 'accepted' });
  const granted = await command(db, ANA, { command: 'grant_assist', expiresAt: null });
  expect(granted.body).toMatchObject({ status: 'accepted' });
  const rows = await db.execute<{ harness_id: string }>(
    sql`SELECT harness_id FROM assistant_accounts WHERE person_id = ${anaId}`,
  );
  return rows[0]?.harness_id ?? '';
}

async function liveAssist(db: Database): Promise<number> {
  const rows = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM delegations WHERE person_id = ${anaId}
      AND capability = 'assist' AND revoked_at IS NULL`,
  );
  return rows[0]?.n ?? 0;
}

async function seededReminder(db: Database, harnessId: string) {
  const requestId = randomUUID();
  const effectId = randomUUID();
  await db.execute(sql`INSERT INTO assistant_requests
      (id, harness_id, person_id, channel, external_id, thread_key, reply_address, note,
       untrusted_parts, received_at, recorded_at)
    VALUES (${requestId}, ${harnessId}, ${anaId}, 'zulip_dm', ${requestId}, 'dm', 'zulip:5005',
      'Remind me to call Ana', '[]'::jsonb, ${at}::timestamptz, ${at}::timestamptz)`);
  await db.execute(sql`INSERT INTO assistant_effects
      (id, harness_id, request_id, kind, idempotency_key, payload, created_at)
    VALUES (${effectId}, ${harnessId}, ${requestId}, 'reminder_set', ${`r:${effectId}`},
      '{"text":"Call Ana"}'::jsonb, ${at}::timestamptz)`);
  await db.execute(sql`INSERT INTO assistant_reminders
      (id, harness_id, person_id, request_id, effect_id, text, due_at, status, created_at)
    VALUES (${randomUUID()}, ${harnessId}, ${anaId}, ${requestId}, ${effectId}, 'Call Ana',
      '2099-01-01T09:00:00.000Z'::timestamptz, 'set', ${at}::timestamptz)`);
  return { requestId, effectId };
}

async function customisesRenewsAndRevokes(db: Database): Promise<void> {
  await turnedOn(db);
  const settings = {
    command: 'customise_assistant',
    displayName: 'Silas',
    instructionsMd: 'Keep it short.',
    timezone: 'Africa/Nairobi',
  };
  const versions = await db.execute<{ version: number }>(
    sql`SELECT s.version FROM assistant_settings s JOIN assistant_accounts a
      ON a.harness_id = s.harness_id WHERE a.person_id = ${anaId}`,
  );
  const expectedVersion = versions[0]?.version ?? 0;
  const saved = await command(db, ANA, { ...settings, expectedVersion });
  expect(saved.body).toMatchObject({ status: 'accepted' });
  const stale = await command(db, ANA, { ...settings, expectedVersion });
  expect(stale.body).toMatchObject({ status: 'error', reason: 'stale_version' });
  const badZone = await command(db, ANA, {
    ...settings,
    timezone: 'Mars/Olympus',
    expectedVersion: expectedVersion + 1,
  });
  expect(badZone.body).toMatchObject({ status: 'error', reason: 'malformed_command' });
  const someone = await command(db, BEN, { ...settings, expectedVersion: 0 });
  expect(someone.body).toMatchObject({ status: 'error', reason: 'no_assistant' });
  const renewed = await command(db, ANA, { command: 'renew_assist', expiresAt: null });
  expect(renewed.body).toMatchObject({ status: 'accepted' });
  expect(await liveAssist(db)).toBe(1);
  const revoked = await command(db, ANA, { command: 'revoke_assist' });
  expect(revoked.body).toMatchObject({ status: 'accepted' });
  expect(await liveAssist(db)).toBe(0);
  const again = await command(db, ANA, { command: 'revoke_assist' });
  expect(again.body).toMatchObject({ status: 'error', reason: 'delegation_not_found' });
}

async function undoesAndDeletesOnlyMine(db: Database): Promise<void> {
  const harnessId = await turnedOn(db);
  const { effectId, requestId } = await seededReminder(db, harnessId);
  const theirs = await command(db, BEN, { command: 'undo_assistant_effect', effectId });
  expect(theirs.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const undone = await command(db, ANA, { command: 'undo_assistant_effect', effectId });
  expect(undone.body).toMatchObject({ status: 'accepted' });
  const twice = await command(db, ANA, { command: 'undo_assistant_effect', effectId });
  expect(twice.body).toMatchObject({ status: 'error', reason: 'effect_not_undoable' });
  const nothing = await command(db, BEN, { command: 'delete_my_assistant_history' });
  expect(nothing.body).toMatchObject({ status: 'error', reason: 'no_assistant' });
  const wiped = await command(db, ANA, { command: 'delete_my_assistant_history' });
  expect(wiped.body).toMatchObject({ status: 'accepted' });
  const [row] = await db.execute<{ note: string; redacted: boolean; status: string }>(
    sql`SELECT r.note, r.redacted_at IS NOT NULL AS redacted, m.status
      FROM assistant_requests r JOIN assistant_reminders m ON m.request_id = r.id
      WHERE r.id = ${requestId}`,
  );
  expect(row).toEqual({ note: '', redacted: true, status: 'cancelled' });
  const names = await db.execute<{ name: string }>(
    sql`SELECT name FROM harness_events WHERE harness_id = ${harnessId}
      AND name IN ('assistant_effect_undone', 'assistant_history_redacted') ORDER BY position`,
  );
  expect(names.map((event) => event.name)).toEqual([
    'assistant_effect_undone',
    'assistant_history_redacted',
  ]);
}

async function refusesBadNamesInPlace(db: Database): Promise<void> {
  await staff(db, benId, BEN);
  const invalid = await command(db, BEN, { command: 'enable_assistant', name: 'Bad Name!' });
  expect(invalid.body).toMatchObject({ status: 'error', reason: 'assistant_name_invalid' });
  const reserved = await command(db, BEN, { command: 'enable_assistant', name: 'support' });
  expect(reserved.body).toMatchObject({ status: 'error', reason: 'assistant_name_reserved' });
}

describe.skipIf(!testServer)('PA-7 the My Assistant person endpoint', () => {
  it('customises at a version, renews and revokes assist, for the person only', () =>
    withAppDatabase(customisesRenewsAndRevokes));

  it('undoes and deletes only the person own assistant work', () =>
    withAppDatabase(undoesAndDeletesOnlyMine));

  it('names an invalid or reserved assistant name so the screen can show it', () =>
    withAppDatabase(refusesBadNamesInPlace));
});
