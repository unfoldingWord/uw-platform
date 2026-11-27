import { eq, sql } from 'drizzle-orm';
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
  `00000000-0000-4000-8000-${(0x782000 + n).toString(16).padStart(12, '0')}`;

const person = uid(1);
const personal = uid(3);
const request = uid(4);
const atText = '2026-11-27T09:00:00.000Z';
const weekText = '2026-12-04T09:00:00.000Z';
const human = `human:${person}`;

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

type Proposal = {
  readonly id: string;
  readonly kind?: string;
  readonly payload?: string;
  readonly status?: string;
  readonly decidedBy?: string | null;
  readonly expiresAt?: string;
};

function propose(db: AnyDatabase, row: Proposal) {
  const decidedBy = row.decidedBy ?? null;
  const decidedAt = decidedBy === null ? null : atText;
  return db.execute(sql`INSERT INTO assistant_proposals
      (id, harness_id, person_id, request_id, kind, payload, status, decided_by, decided_at,
       expires_at, created_at)
    VALUES (${row.id}, ${personal}, ${person}, ${request}, ${row.kind ?? 'email'},
      ${row.payload ?? '{"to":["ana@example.org"],"subject":"Notes","body":"Hi"}'}::jsonb,
      ${row.status ?? 'pending'}, ${decidedBy}, ${decidedAt}::timestamptz,
      ${row.expiresAt ?? weekText}::timestamptz, ${atText}::timestamptz)`);
}

function effect(db: AnyDatabase, id: string, kind: string, proposalId: string | null) {
  return db.execute(sql`INSERT INTO assistant_effects
      (id, harness_id, request_id, kind, idempotency_key, payload, created_at, proposal_id)
    VALUES (${id}, ${personal}, ${request}, ${kind}, ${`k:${id}`}, '{}'::jsonb,
      ${atText}::timestamptz, ${proposalId})`);
}

async function digestOf(db: AnyDatabase, id: string): Promise<string> {
  const { assistantProposals } = schema;
  const rows = await db
    .select({ digest: assistantProposals.digest })
    .from(assistantProposals)
    .where(eq(assistantProposals.id, id));
  return rows[0]?.digest ?? '';
}

function openDatabase(target: DatabaseTarget): () => AnyDatabase {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
    await seedPerson(opened.db, { id: person, email: 'proposal-person@example.org' });
    await opened.db.execute(sql`INSERT INTO harnesses
        (id, key, title, template, jd_area, created_at, person_id)
      VALUES (${personal}, ${`assistant-${person}`}, 'Assistant', 'assistant', '10-19',
        ${atText}::timestamptz, ${person})`);
    await opened.db.execute(sql`INSERT INTO assistant_requests
        (id, harness_id, person_id, channel, external_id, thread_key, reply_address, note,
         untrusted_parts, received_at, recorded_at)
      VALUES (${request}, ${personal}, ${person}, 'zulip_dm', 'proposal-1', 'dm', 'zulip:7',
        'Find a time', '[]'::jsonb, ${atText}::timestamptz, ${atText}::timestamptz)`);
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

function proposalRules(db: () => AnyDatabase): void {
  it('computes the digest from the payload itself, so a changed payload has a new digest', async () => {
    await propose(db(), { id: uid(10) });
    const digest = await digestOf(db(), uid(10));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    await propose(db(), { id: uid(11), payload: '{"to":["ben@example.org"],"body":"Hi"}' });
    expect(await digestOf(db(), uid(11))).not.toBe(digest);
  });

  it('lets only a human decide, and only with the time it was decided', async () => {
    expect(
      await refusal(propose(db(), { id: uid(12), status: 'accepted', decidedBy: 'agent:x' })),
    ).toEqual({ code: '23514', constraint: 'assistant_proposals_decided_by_human' });
    expect(await refusal(propose(db(), { id: uid(13), status: 'accepted' }))).toEqual({
      code: '23514',
      constraint: 'assistant_proposals_decided_together',
    });
    expect(
      await refusal(propose(db(), { id: uid(14), status: 'expired', decidedBy: human })),
    ).toEqual({ code: '23514', constraint: 'assistant_proposals_decided_together' });
    await propose(db(), { id: uid(15), status: 'accepted', decidedBy: human });
  });

  it('closes the kinds and statuses and expires a proposal seven days after it was made', async () => {
    expect(await refusal(propose(db(), { id: uid(16), kind: 'payment' }))).toEqual({
      code: '23514',
      constraint: 'assistant_proposals_kind_known',
    });
    expect(await refusal(propose(db(), { id: uid(17), status: 'approved' }))).toEqual({
      code: '23514',
      constraint: 'assistant_proposals_status_known',
    });
    expect(
      await refusal(propose(db(), { id: uid(18), expiresAt: '2026-12-25T09:00:00.000Z' })),
    ).toEqual({ code: '23514', constraint: 'assistant_proposals_expires_in_a_week' });
  });
}

function settledRules(db: () => AnyDatabase): void {
  it('keeps a proposal as it was once decided, and its payload as it was drafted', async () => {
    await propose(db(), { id: uid(19) });
    expect(
      await refusal(
        db().execute(
          sql`UPDATE assistant_proposals SET payload = '{"to":["x@example.org"]}'::jsonb WHERE id = ${uid(19)}`,
        ),
      ),
    ).toEqual({ code: '23514', constraint: 'assistant_proposals_settled' });
    await db().execute(sql`UPDATE assistant_proposals
      SET status = 'declined', decided_by = ${human}, decided_at = ${atText}::timestamptz
      WHERE id = ${uid(19)}`);
    expect(
      await refusal(
        db().execute(sql`UPDATE assistant_proposals SET status = 'accepted' WHERE id = ${uid(19)}`),
      ),
    ).toEqual({ code: '23514', constraint: 'assistant_proposals_settled' });
    expect(
      await refusal(db().execute(sql`DELETE FROM assistant_proposals WHERE id = ${uid(19)}`)),
    ).toEqual({ code: '23514', constraint: 'assistant_proposals_settled' });
    await db().execute(sql`UPDATE assistant_proposals
      SET payload = '{}'::jsonb, redacted_at = ${atText}::timestamptz WHERE id = ${uid(19)}`);
  });
}

function effectRules(db: () => AnyDatabase): void {
  it('refuses an effect outside the direct set without a proposal', async () => {
    expect(await refusal(effect(db(), uid(40), 'email_sent', null))).toEqual({
      code: '23514',
      constraint: 'assistant_effects_direct_or_decided',
    });
    expect(await refusal(effect(db(), uid(41), 'reply_to_requester', uid(15)))).toEqual({
      code: '23514',
      constraint: 'assistant_effects_direct_or_decided',
    });
  });

  it('refuses an effect whose proposal is undecided, declined or of another kind', async () => {
    await propose(db(), { id: uid(20) });
    expect(await refusal(effect(db(), uid(42), 'email_sent', uid(20)))).toEqual({
      code: '23514',
      constraint: 'assistant_effects_decided_proposal',
    });
    await propose(db(), { id: uid(21), status: 'declined', decidedBy: human });
    expect(await refusal(effect(db(), uid(43), 'email_sent', uid(21)))).toEqual({
      code: '23514',
      constraint: 'assistant_effects_decided_proposal',
    });
    expect(await refusal(effect(db(), uid(44), 'page_appended', uid(15)))).toEqual({
      code: '23514',
      constraint: 'assistant_effects_decided_proposal',
    });
  });

  it('runs an accepted proposal as one effect only', async () => {
    await effect(db(), uid(45), 'email_sent', uid(15));
    expect(await refusal(effect(db(), uid(46), 'email_sent', uid(15)))).toEqual({
      code: '23505',
      constraint: 'assistant_effects_proposal_once',
    });
  });
}

describe('PA-12 the proposal table and the decided-proposal effects', () => {
  it('declares proposals restricted and never offline', () => {
    expect(declarationOf(schema.assistantProposals)).toEqual({
      classification: 'restricted',
      offlineEligibility: 'never',
    });
  });

  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => {
      const db = openDatabase(target);
      proposalRules(db);
      settledRules(db);
      effectRules(db);
    },
  );
});
