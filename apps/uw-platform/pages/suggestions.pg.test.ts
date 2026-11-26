import { describe, expect, it } from 'vitest';
import { principalSchema, type Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPage, seedPerson } from '@uw/db/test-seed';
import { personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { writePageAsAgent } from './agent-write.ts';
import { acceptSuggestion, rejectSuggestion } from './suggestion-decisions.ts';
import { pendingSuggestions } from './suggestions.ts';
import { readPage } from './store.ts';

const EDITOR = { id: '00000000-0000-4000-8000-000000002c01', email: 'suggest@unfoldingword.org' };
const AREA = '00-09';
const ON = new Date('2026-12-01T12:00:00.000Z');
const POLICY = '00000000-0000-4000-8000-000000002c11';
const frontmatter = { enforcement: 'required', effective_from: '2026-01-01' };

type World = { readonly person: Principal; readonly agent: Principal };

async function world(db: Database): Promise<World> {
  await seedPerson(db, EDITOR);
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000002c02',
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
    slug: 'safeguarding',
    title: 'Safeguarding',
    bodyMd: 'Two adults are present.',
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

function suggest(db: Database, agent: Principal, bodyMd: string) {
  const input = {
    pageId: POLICY,
    type: 'policy' as const,
    jdArea: AREA,
    slug: 'safeguarding',
    title: 'Safeguarding',
    parentId: null,
    frontmatter,
    bodyMd,
    expectedVersion: 1,
  };
  const request = {
    traceId: crypto.randomUUID(),
    at: ON,
    instructions: { namesInstructions: () => Promise.resolve(false) },
    writer: null,
  };
  return writePageAsAgent(db, agent, input, request);
}

async function suggestionOf(db: Database, agent: Principal, bodyMd: string): Promise<string> {
  const held = await suggest(db, agent, bodyMd);
  if (!held.ok || held.suggestionId === undefined) throw new Error('no suggestion was held');
  return held.suggestionId;
}

const decide = (suggestionId: string, revision = 1) => ({
  requestId: crypto.randomUUID(),
  suggestionId,
  revision,
});

async function heldThenAccepted(db: Database): Promise<void> {
  const { person, agent } = await world(db);
  const first = await suggestionOf(db, agent, 'Two adults are present and named.');
  expect((await readPage(db, person, POLICY, ON))?.bodyMd).toBe('Two adults are present.');
  const again = await suggestionOf(db, agent, 'Two named adults are present.');
  expect(again).toBe(first);
  const page = await readPage(db, person, POLICY, ON);
  if (page === null) throw new Error('the policy is missing');
  expect((await pendingSuggestions(db, person, page, ON)).map((open) => open.id)).toEqual([first]);
  const seenFirst = { command: 'accept_suggestion' as const, ...decide(first, 1) };
  const changed = await acceptSuggestion(db, person, seenFirst, crypto.randomUUID(), ON);
  expect(changed).toMatchObject({ ok: false, reason: 'suggestion_changed' });
  const command = { command: 'accept_suggestion' as const, ...decide(first, 2) };
  const accepted = await acceptSuggestion(db, person, command, crypto.randomUUID(), ON);
  expect(accepted).toMatchObject({ ok: true, page: { version: 2, status: 'active' } });
  expect((await readPage(db, person, POLICY, ON))?.bodyMd).toBe('Two named adults are present.');
  expect(await pendingSuggestions(db, person, page, ON)).toEqual([]);
  const replay = await acceptSuggestion(db, person, command, crypto.randomUUID(), ON);
  expect(replay).toMatchObject({ ok: true, page: { version: 2 } });
  const twice = await acceptSuggestion(
    db,
    person,
    { ...command, requestId: crypto.randomUUID() },
    crypto.randomUUID(),
    ON,
  );
  expect(twice).toMatchObject({ ok: false, reason: 'suggestion_decided' });
}

async function rejectedAndAgentsRefused(db: Database): Promise<void> {
  const { person, agent } = await world(db);
  const id = await suggestionOf(db, agent, 'Anyone may supervise.');
  const accept = { command: 'accept_suggestion' as const, ...decide(id) };
  const byAgent = await acceptSuggestion(db, agent, accept, crypto.randomUUID(), ON);
  expect(byAgent).toMatchObject({ ok: false, reason: 'not_permitted' });
  const reject = { command: 'reject_suggestion' as const, ...decide(id) };
  expect(await rejectSuggestion(db, person, reject, crypto.randomUUID(), ON)).toMatchObject({
    ok: true,
    page: { version: 1 },
  });
  expect((await readPage(db, person, POLICY, ON))?.bodyMd).toBe('Two adults are present.');
  expect(await acceptSuggestion(db, person, accept, crypto.randomUUID(), ON)).toMatchObject({
    ok: false,
    reason: 'suggestion_decided',
  });
}

async function staleOnceThePageMoves(db: Database): Promise<void> {
  const { person, agent } = await world(db);
  const id = await suggestionOf(db, agent, 'Two adults, one of them trained.');
  const other = principalSchema.parse({ ...agent, identity: `agent:${EDITOR.id}/desktop` });
  const rival = await suggestionOf(db, other, 'Three adults are present.');
  const first = { command: 'accept_suggestion' as const, ...decide(rival) };
  expect(await acceptSuggestion(db, person, first, crypto.randomUUID(), ON)).toMatchObject({
    ok: true,
  });
  const late = { command: 'accept_suggestion' as const, ...decide(id) };
  expect(await acceptSuggestion(db, person, late, crypto.randomUUID(), ON)).toMatchObject({
    ok: false,
    reason: 'stale_version',
  });
}

describe.skipIf(!testServer)('PO-7 an agent suggests a change to an active policy', () => {
  it('holds the change as one pending set per agent, refuses a decision on a revision the person did not see, and accepts it once as one new version', () =>
    withAppDatabase(heldThenAccepted));

  it('lets a person reject it, leaves the page alone, and refuses an agent deciding', () =>
    withAppDatabase(rejectedAndAgentsRefused));

  it('refuses a set whose base version is no longer the page version', () =>
    withAppDatabase(staleOnceThePageMoves));
});
