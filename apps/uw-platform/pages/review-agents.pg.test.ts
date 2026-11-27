import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { principalSchema, type Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPage, seedPerson } from '@uw/db/test-seed';
import { personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { writePageAsAgent } from './agent-write.ts';
import { acceptReviewSet } from './review-decisions.ts';
import { pendingReviewSets, reviewSetFor } from './review-sets.ts';
import { readPage, updatePage } from './store.ts';

const EDITOR = { id: '00000000-0000-4000-8000-000000003b01', email: 'bo.example@example.org' };
const AREA = '00-09';
const ON = new Date('2026-12-01T12:00:00.000Z');
const POLICY = '00000000-0000-4000-8000-000000003b11';
const LEARNING = '00000000-0000-4000-8000-000000003b12';
const DECISION = '00000000-0000-4000-8000-000000003b13';
const DECIDED = '## Context\nC.\n## Decision\nTwo adults.\n## Consequences\nQ.';
const BODY = 'Two adults are present at every session.\n\nRecords are kept.';
const frontmatter = { enforcement: 'required', effective_from: '2026-01-01' };

type World = { readonly person: Principal; readonly agent: Principal };

async function world(db: Database): Promise<World> {
  await seedPerson(db, EDITOR);
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000003b02',
    personId: EDITOR.id,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: AREA,
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  const base = { status: 'active' as const, jdArea: AREA, bodyMd: BODY };
  await seedPage(db, {
    ...base,
    id: POLICY,
    type: 'policy',
    slug: 'sessions',
    title: 'Sessions',
    frontmatter,
  });
  await seedPage(db, {
    ...base,
    id: LEARNING,
    type: 'learning',
    slug: 'sessions-learning',
    title: 'Sessions learning',
    frontmatter: { confidence: 'observed', as_of: '2026-10-01', supersedes: [], review_by: null },
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

function agentWrites(db: Database, agent: Principal, edit: { title: string; bodyMd: string }) {
  const input = {
    pageId: POLICY,
    type: 'policy' as const,
    jdArea: AREA,
    slug: 'sessions',
    parentId: null,
    frontmatter,
    expectedVersion: 1,
    ...edit,
  };
  const request = {
    traceId: crypto.randomUUID(),
    at: ON,
    instructions: { namesInstructions: () => Promise.resolve(false) },
    writer: null,
  };
  return writePageAsAgent(db, agent, input, request);
}

async function versionsOf(db: Database, pageId: string) {
  const [row] = await db.execute<{ version: number; body: string; kept: number }>(sql`SELECT
    version, body_md AS body,
    (SELECT count(*)::int FROM page_versions WHERE page_id = ${pageId}) AS kept
    FROM pages WHERE id = ${pageId}`);
  return row;
}

async function agentHeldAsReviewSet(db: Database): Promise<void> {
  const { person, agent } = await world(db);
  const first = await agentWrites(db, agent, {
    title: 'Sessions',
    bodyMd: 'Two adults are present at each session.\n\nRecords are kept.',
  });
  expect(first).toMatchObject({ ok: true, page: { version: 1, bodyMd: BODY } });
  expect(await versionsOf(db, POLICY)).toEqual({ version: 1, body: BODY, kept: 0 });
  const second = await agentWrites(db, agent, {
    title: 'Supervised sessions',
    bodyMd: 'Two trained adults are present at each session.\n\nRecords are kept.',
  });
  if (!first.ok || !second.ok) throw new Error('the agent was refused');
  expect(second.reviewSetId).toBe(first.reviewSetId);
  const found = await reviewSetFor(db, person, second.reviewSetId ?? '', ON);
  expect(found?.set).toMatchObject({
    revision: 2,
    title: 'Supervised sessions',
    frontmatter: null,
  });
  expect(found?.changes.map(({ kind, anchor, text }) => [kind, anchor.exact, text])).toEqual([
    ['insertion', '', 'trained '],
    ['replacement', 'every', 'each'],
  ]);
  const page = await readPage(db, person, POLICY, ON);
  if (page === null) throw new Error('the policy is missing');
  expect((await pendingReviewSets(db, person, page, ON)).map((set) => set.id)).toEqual([
    second.reviewSetId,
  ]);
  const accept = {
    command: 'accept_review_set' as const,
    requestId: crypto.randomUUID(),
    reviewSetId: second.reviewSetId ?? '',
    revision: 2,
  };
  expect(await acceptReviewSet(db, person, accept, crypto.randomUUID(), ON)).toMatchObject({
    ok: true,
    page: {
      version: 2,
      title: 'Supervised sessions',
      bodyMd: 'Two trained adults are present at each session.\n\nRecords are kept.',
    },
  });
}

async function agentDecisionHeldAsReviewSet(db: Database): Promise<void> {
  const { person, agent } = await world(db);
  const decided = { decided_on: '2026-11-25', applies_to: null, supersedes: [] };
  await seedPage(db, {
    id: DECISION,
    type: 'decision',
    status: 'active',
    jdArea: AREA,
    slug: 'two-adults',
    title: 'Two adults',
    bodyMd: DECIDED,
    frontmatter: decided,
  });
  const held = await writePageAsAgent(
    db,
    agent,
    {
      pageId: DECISION,
      type: 'decision',
      jdArea: AREA,
      slug: 'two-adults',
      title: 'Two adults',
      parentId: null,
      frontmatter: decided,
      bodyMd: DECIDED.replace('Two adults.', 'Two trained adults.'),
      expectedVersion: 1,
    },
    {
      traceId: crypto.randomUUID(),
      at: ON,
      instructions: { namesInstructions: () => Promise.resolve(false) },
      writer: null,
    },
  );
  if (!held.ok || held.reviewSetId === undefined) throw new Error('no review set was held');
  expect(await versionsOf(db, DECISION)).toEqual({ version: 1, body: DECIDED, kept: 0 });
  const found = await reviewSetFor(db, person, held.reviewSetId, ON);
  expect(found?.changes.map(({ kind, text }) => [kind, text])).toEqual([['insertion', 'trained ']]);
}

async function agentCannotSaveGatedBodies(db: Database): Promise<void> {
  const { agent } = await world(db);
  const command = {
    command: 'update_page' as const,
    requestId: crypto.randomUUID(),
    pageId: POLICY,
    expectedVersion: 1,
    slug: 'sessions',
    title: 'Sessions',
    parentId: null,
    frontmatter,
    bodyMd: 'Nobody needs to be present.',
    status: 'active' as const,
  };
  expect(await updatePage(db, agent, command, crypto.randomUUID(), ON)).toMatchObject({
    ok: false,
    reason: 'not_permitted',
  });
  const learning = {
    ...command,
    pageId: LEARNING,
    slug: 'sessions-learning',
    title: 'Sessions learning',
    frontmatter: { confidence: 'observed', as_of: '2026-10-01', supersedes: [], review_by: null },
  };
  expect(await updatePage(db, agent, learning, crypto.randomUUID(), ON)).toMatchObject({
    ok: false,
    reason: 'not_permitted',
  });
  expect(await versionsOf(db, POLICY)).toEqual({ version: 1, body: BODY, kept: 0 });
  expect(await versionsOf(db, LEARNING)).toEqual({ version: 1, body: BODY, kept: 0 });
}

describe.skipIf(!testServer)("#197 an agent cannot replace a gated page's body directly", () => {
  it("holds an agent's save to an active policy as one review set of word-level changes", () =>
    withAppDatabase(agentHeldAsReviewSet));

  it("holds an agent's edit to an active decision as a review set", () =>
    withAppDatabase(agentDecisionHeldAsReviewSet));

  it('refuses an agent principal on the save path a person uses, for every gated type', () =>
    withAppDatabase(agentCannotSaveGatedBodies));
});
