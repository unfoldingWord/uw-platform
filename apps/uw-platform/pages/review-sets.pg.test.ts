import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { principalSchema, type Principal, type SuggestedChangeInput } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { pageReviewDecisions } from '@uw/db/schema';
import { seedGrant, seedPage, seedPerson } from '@uw/db/test-seed';
import { personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { anchorOf } from './anchors.ts';
import { acceptReviewSet, rejectReviewSet } from './review-decisions.ts';
import { proposeReviewSet, reviewSetFor } from './review-sets.ts';
import { readPage } from './store.ts';

const EDITOR = { id: '00000000-0000-4000-8000-000000003a01', email: 'ada.example@example.org' };
const AREA = '00-09';
const ON = new Date('2026-12-01T12:00:00.000Z');
const POLICY = '00000000-0000-4000-8000-000000003a11';
const BODY = 'Two adults are present.\n\nRecords are kept for a year.';
const frontmatter = { enforcement: 'required', effective_from: '2026-01-01' };

type World = { readonly person: Principal; readonly agent: Principal };

async function world(db: Database): Promise<World> {
  await seedPerson(db, EDITOR);
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000003a02',
    personId: EDITOR.id,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: AREA,
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  await seedPage(db, {
    id: POLICY,
    type: 'policy',
    status: 'active',
    jdArea: AREA,
    slug: 'supervision',
    title: 'Supervision',
    bodyMd: BODY,
    frontmatter,
  });
  const person = await personOn(db, EDITOR.id, EDITOR.email, ON);
  const agent = principalSchema.parse({
    ...person,
    identity: `agent:${EDITOR.id}/laptop`,
    kind: 'agent',
    email: null,
  });
  return { person, agent };
}

function change(
  kind: SuggestedChangeInput['kind'],
  span: readonly [number, number],
  text = '',
  note: string | null = null,
): SuggestedChangeInput {
  return { kind, anchor: anchorOf(BODY, span[0], span[1]), text, note };
}

const boardChanges = [
  change('replacement', [0, 3], 'Three'),
  change('insertion', [4, 4], 'trained '),
  change('comment', [25, 32], '', 'Paper records too?'),
  change('deletion', [41, 52]),
];

function propose(db: Database, actor: Principal, changes = boardChanges, baseVersion = 1) {
  const command = {
    command: 'propose_review_set' as const,
    requestId: crypto.randomUUID(),
    pageId: POLICY,
    baseVersion,
    name: 'Board review 2026-12-01',
    changes,
  };
  return proposeReviewSet(db, actor, command, crypto.randomUUID(), ON);
}

async function proposed(db: Database, actor: Principal, changes = boardChanges): Promise<string> {
  const held = await propose(db, actor, changes);
  if (!held.ok || held.reviewSetId === undefined) throw new Error('no review set was made');
  return held.reviewSetId;
}

const decide = (reviewSetId: string, revision = 1) => ({
  requestId: crypto.randomUUID(),
  reviewSetId,
  revision,
});

async function counts(db: Database) {
  const [row] = await db.execute<{ versions: number; decisions: number }>(sql`SELECT
    (SELECT count(*)::int FROM page_versions WHERE page_id = ${POLICY}) AS versions,
    (SELECT count(*)::int FROM page_review_decisions) AS decisions`);
  return row;
}

async function acceptedAsOneVersion(db: Database): Promise<void> {
  const { person } = await world(db);
  const id = await proposed(db, person);
  const before = await counts(db);
  const command = { command: 'accept_review_set' as const, ...decide(id) };
  const accepted = await acceptReviewSet(db, person, command, crypto.randomUUID(), ON);
  expect(accepted).toMatchObject({ ok: true, page: { version: 2, status: 'active' } });
  expect((await readPage(db, person, POLICY, ON))?.bodyMd).toBe(
    'Three trained adults are present.\n\nRecords are kept.',
  );
  expect(await counts(db)).toEqual({
    versions: (before?.versions ?? 0) + 1,
    decisions: (before?.decisions ?? 0) + 1,
  });
  const audit = await db.select().from(pageReviewDecisions);
  expect(audit).toMatchObject([
    { reviewSetId: id, decision: 'accepted', acceptedVersion: 2, decidedBy: person.identity },
  ]);
  const replay = await acceptReviewSet(db, person, command, crypto.randomUUID(), ON);
  expect(replay).toMatchObject({ ok: true, page: { version: 2 } });
  const again = { ...command, requestId: crypto.randomUUID() };
  expect(await acceptReviewSet(db, person, again, crypto.randomUUID(), ON)).toMatchObject({
    ok: false,
    reason: 'suggestion_decided',
  });
  expect(await counts(db)).toEqual({
    versions: (before?.versions ?? 0) + 1,
    decisions: (before?.decisions ?? 0) + 1,
  });
}

async function rejectedWithoutAVersion(db: Database): Promise<void> {
  const { person, agent } = await world(db);
  const id = await proposed(db, person);
  const accept = { command: 'accept_review_set' as const, ...decide(id) };
  expect(await acceptReviewSet(db, agent, accept, crypto.randomUUID(), ON)).toMatchObject({
    ok: false,
    reason: 'not_permitted',
  });
  const reject = { command: 'reject_review_set' as const, ...decide(id) };
  expect(await rejectReviewSet(db, agent, reject, crypto.randomUUID(), ON)).toMatchObject({
    ok: false,
    reason: 'not_permitted',
  });
  const before = await counts(db);
  expect(await rejectReviewSet(db, person, reject, crypto.randomUUID(), ON)).toMatchObject({
    ok: true,
    page: { version: 1 },
  });
  expect(await counts(db)).toEqual({
    versions: before?.versions,
    decisions: (before?.decisions ?? 0) + 1,
  });
  expect((await readPage(db, person, POLICY, ON))?.bodyMd).toBe(BODY);
  expect((await reviewSetFor(db, person, id, ON))?.set.status).toBe('rejected');
}

async function staleOnlyRejected(db: Database): Promise<void> {
  const { person } = await world(db);
  const first = await proposed(db, person, [change('replacement', [0, 3], 'Three')]);
  const second = await proposed(db, person, [change('deletion', [41, 52])]);
  const accept = { command: 'accept_review_set' as const, ...decide(first) };
  expect(await acceptReviewSet(db, person, accept, crypto.randomUUID(), ON)).toMatchObject({
    ok: true,
  });
  const late = { command: 'accept_review_set' as const, ...decide(second) };
  expect(await acceptReviewSet(db, person, late, crypto.randomUUID(), ON)).toMatchObject({
    ok: false,
    reason: 'stale_version',
  });
  const reject = { command: 'reject_review_set' as const, ...decide(second) };
  expect(await rejectReviewSet(db, person, reject, crypto.randomUUID(), ON)).toMatchObject({
    ok: true,
  });
  expect(await propose(db, person, boardChanges, 1)).toMatchObject({
    ok: false,
    reason: 'stale_version',
  });
}

async function badSetsRefused(db: Database): Promise<void> {
  const { person } = await world(db);
  const crossing = [change('replacement', [4, 10], 'people'), change('comment', [6, 14], '', 'x')];
  expect(await propose(db, person, crossing)).toMatchObject({
    ok: false,
    reason: 'changes_overlap',
    detail: { changes: ['1'] },
  });
  const gone = {
    kind: 'deletion' as const,
    anchor: { start: 0, end: 5, exact: 'Seven', prefix: '', suffix: ' monkeys' },
    text: '',
    note: null,
  };
  expect(await propose(db, person, [gone])).toMatchObject({
    ok: false,
    reason: 'anchor_orphaned',
    detail: { changes: ['0'] },
  });
  const moved = {
    ...change('deletion', [41, 52]),
    anchor: { ...anchorOf(BODY, 41, 52), start: 3, end: 14 },
  };
  const held = await propose(db, person, [moved]);
  if (!held.ok || held.reviewSetId === undefined) throw new Error('the quote did not anchor');
  const found = await reviewSetFor(db, person, held.reviewSetId, ON);
  expect(found?.changes.map((one) => one.anchor)).toEqual([anchorOf(BODY, 41, 52)]);
  const sets = await db.execute(sql`SELECT count(*)::int AS n FROM page_review_sets`);
  expect(Array.from(sets)).toEqual([{ n: 1 }]);
}

async function replayedOnce(db: Database): Promise<void> {
  const { person } = await world(db);
  const command = {
    command: 'propose_review_set' as const,
    requestId: crypto.randomUUID(),
    pageId: POLICY,
    baseVersion: 1,
    name: 'Counsel redline',
    changes: boardChanges,
  };
  const first = await proposeReviewSet(db, person, command, crypto.randomUUID(), ON);
  const second = await proposeReviewSet(db, person, command, crypto.randomUUID(), ON);
  expect(first.ok && second.ok && first.reviewSetId === second.reviewSetId).toBe(true);
  const found = first.ok ? await reviewSetFor(db, person, first.reviewSetId ?? '', ON) : null;
  expect(
    found?.changes.map(({ kind, anchor, text, note }) => ({ kind, anchor, text, note })),
  ).toEqual(boardChanges);
  const sets = await db.execute(sql`SELECT count(*)::int AS n FROM page_review_sets
    WHERE page_id = ${POLICY}`);
  expect(Array.from(sets)).toEqual([{ n: 1 }]);
}

describe.skipIf(!testServer)('#197 a review set is accepted or rejected as a whole', () => {
  it('accepts a review set as exactly one new version and one audit row, and answers a replay once', () =>
    withAppDatabase(acceptedAsOneVersion));

  it('rejects a review set with one audit row and no version, and refuses an agent deciding', () =>
    withAppDatabase(rejectedWithoutAVersion));

  it('refuses accepting a set whose base is no longer the page version, and only rejects it', () =>
    withAppDatabase(staleOnlyRejected));

  it('refuses overlapping changes and an orphaned anchor, and anchors a moved span by its quote', () =>
    withAppDatabase(badSetsRefused));

  it('makes one set for one request and keeps its changes as proposed', () =>
    withAppDatabase(replayedOnce));
});
