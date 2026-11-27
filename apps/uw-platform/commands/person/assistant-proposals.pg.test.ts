import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPage, seedPerson } from '@uw/db/test-seed';
import { post } from '../../testing/commands.ts';
import { testServer, withAppDatabase } from '../../testing/postgres.ts';

const ANA = 'ana.proposals@unfoldingword.org';
const BEN = 'ben.proposals@unfoldingword.org';
const anaId = '00000000-0000-4000-8000-0000000e3901';
const benId = '00000000-0000-4000-8000-0000000e3902';
const notesId = '00000000-0000-4000-8000-0000000e3911';
const at = new Date();

async function staff(db: Database, id: string, email: string): Promise<void> {
  await seedPerson(db, { id, email });
  for (const [role, area] of [
    ['viewer', '30-39'],
    ['editor', '20-29'],
  ] as const) {
    await seedGrant(db, {
      id: randomUUID(),
      personId: id,
      role,
      scopeKind: 'jd_area',
      scopeArea: area,
      grantedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: null,
    });
  }
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
  expect(
    (await command(db, ANA, { command: 'enable_assistant', name: 'tabitha' })).body,
  ).toMatchObject({ status: 'accepted' });
  const rows = await db.execute<{ harness_id: string }>(
    sql`SELECT harness_id FROM assistant_accounts WHERE person_id = ${anaId}`,
  );
  return rows[0]?.harness_id ?? '';
}

async function proposal(db: Database, harnessId: string, kind: string, payload: object) {
  const requestId = randomUUID();
  const id = randomUUID();
  const created = at.toISOString();
  await db.execute(sql`INSERT INTO assistant_requests
      (id, harness_id, person_id, channel, external_id, thread_key, reply_address, note,
       untrusted_parts, received_at, recorded_at)
    VALUES (${requestId}, ${harnessId}, ${anaId}, 'zulip_dm', ${requestId}, 'dm', 'zulip:5005',
      'Add the transcript', '[]'::jsonb, ${created}::timestamptz, ${created}::timestamptz)`);
  await db.execute(sql`INSERT INTO assistant_proposals
      (id, harness_id, person_id, request_id, kind, payload, status, expires_at, created_at)
    VALUES (${id}, ${harnessId}, ${anaId}, ${requestId}, ${kind}, ${JSON.stringify(payload)}::jsonb,
      'pending', ${created}::timestamptz + interval '7 days', ${created}::timestamptz)`);
  const rows = await db.execute<{ digest: string }>(
    sql`SELECT digest FROM assistant_proposals WHERE id = ${id}`,
  );
  return { id, digest: rows[0]?.digest ?? '' };
}

async function statusOf(db: Database, id: string): Promise<string> {
  const rows = await db.execute<{ status: string }>(
    sql`SELECT status FROM assistant_proposals WHERE id = ${id}`,
  );
  return rows[0]?.status ?? '';
}

async function onlyTheOwnerDecidesOnTheDigest(db: Database): Promise<void> {
  const harnessId = await turnedOn(db);
  const mail = { to: ['ben@example.org'], subject: 'Notes', body: 'Here they are.' };
  const email = await proposal(db, harnessId, 'email', mail);
  const decide = { command: 'decide_assistant_proposal', proposalId: email.id };
  const ben = await command(db, BEN, { ...decide, decision: 'accept', digest: email.digest });
  expect(ben.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const stale = await command(db, ANA, { ...decide, decision: 'accept', digest: 'a'.repeat(64) });
  expect(stale.body).toMatchObject({ status: 'error', reason: 'proposal_not_decidable' });
  const declined = await command(db, ANA, { ...decide, decision: 'decline', digest: email.digest });
  expect(declined.body).toMatchObject({ status: 'accepted' });
  expect(await statusOf(db, email.id)).toBe('declined');
  const again = await command(db, ANA, { ...decide, decision: 'accept', digest: email.digest });
  expect(again.body).toMatchObject({ status: 'error', reason: 'proposal_not_decidable' });
}

async function acceptedNotesLandOnThePageAsThePerson(db: Database): Promise<void> {
  const harnessId = await turnedOn(db);
  await seedPage(db, {
    id: notesId,
    type: 'knowledge',
    status: 'active',
    jdArea: '20-29',
    slug: 'ruth-notes',
    title: 'Ruth 2 notes',
    bodyMd: '# Ruth 2 notes',
    frontmatter: { jd_category: '21' },
  });
  const append = { pageId: notesId, heading: 'Checking meeting', text: 'We chose option two.' };
  const notes = await proposal(db, harnessId, 'page_append', append);
  const accepted = await command(db, ANA, {
    command: 'decide_assistant_proposal',
    proposalId: notes.id,
    decision: 'accept',
    digest: notes.digest,
  });
  expect(accepted.body).toMatchObject({ status: 'accepted' });
  const pages = await db.execute<{ body_md: string; version: number }>(
    sql`SELECT body_md, version FROM pages WHERE id = ${notesId}`,
  );
  expect(pages[0]?.version).toBe(2);
  expect(pages[0]?.body_md).toContain('## Checking meeting\n\nWe chose option two.');
  const versions = await db.execute<{ edit_source: string }>(
    sql`SELECT edit_source FROM page_versions WHERE page_id = ${notesId} AND version = 2`,
  );
  expect(versions[0]?.edit_source).toBe(`human:${anaId}`);
}

describe.skipIf(!testServer)('PA-12 decide_assistant_proposal on the person endpoint', () => {
  it('lets only the person decide, on the digest they saw, once', () =>
    withAppDatabase(onlyTheOwnerDecidesOnTheDigest));
  it('writes accepted notes onto a page the person can edit, as the person', () =>
    withAppDatabase(acceptedNotesLandOnThePageAsThePerson));
});
