import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { principalSchema, type Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { pageSuggestionSets, pages } from '@uw/db/schema';
import { seedGrant, seedPage, seedPerson } from '@uw/db/test-seed';
import { personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { writePageAsAgent } from './agent-write.ts';
import { acceptSuggestion } from './suggestion-decisions.ts';

const EDITOR = { id: '00000000-0000-4000-8000-000000002e01', email: 'races@unfoldingword.org' };
const AREA = '00-09';
const ON = new Date('2026-12-01T12:00:00.000Z');
const POLICY = '00000000-0000-4000-8000-000000002e11';
const frontmatter = { enforcement: 'required', effective_from: '2026-01-01' };

async function world(db: Database): Promise<{ person: Principal; agent: Principal }> {
  await seedPerson(db, EDITOR);
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000002e02',
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

function propose(db: Database, agent: Principal, bodyMd: string) {
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

async function selfEmbedRefused(db: Database): Promise<void> {
  const { agent } = await world(db);
  const held = await propose(db, agent, '![[Safeguarding]]');
  expect(held).toMatchObject({ ok: false, reason: 'embed_cycle' });
  expect(await db.select().from(pageSuggestionSets)).toEqual([]);
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function overlapDoesNotDeadlock(db: Database): Promise<void> {
  const { person, agent } = await world(db);
  const held = await propose(db, agent, 'Two named adults are present.');
  if (!held.ok || held.suggestionId === undefined) throw new Error('no suggestion was held');
  const suggestionId = held.suggestionId;
  let accepting: Promise<unknown> = Promise.resolve();
  const writer = db.transaction(async (tx) => {
    await tx.select().from(pages).where(eq(pages.id, POLICY)).for('update');
    const command = {
      command: 'accept_suggestion' as const,
      requestId: crypto.randomUUID(),
      suggestionId,
      revision: 1,
    };
    accepting = acceptSuggestion(db, person, command, crypto.randomUUID(), ON);
    await pause(300);
    await tx
      .select()
      .from(pageSuggestionSets)
      .where(eq(pageSuggestionSets.id, suggestionId))
      .for('update');
  });
  await expect(writer).resolves.toBeUndefined();
  await expect(accepting).resolves.toMatchObject({ ok: true, page: { version: 2 } });
}

describe.skipIf(!testServer)('PO-7 a suggestion is checked and locked like a save', () => {
  it('refuses a proposal that would embed its own page, before storing it', () =>
    withAppDatabase(selfEmbedRefused));

  it('locks the page before the suggestion, so a save and a decision that overlap both finish', () =>
    withAppDatabase(overlapDoesNotDeadlock));
});
