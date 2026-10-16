import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { principalSchema, type Page, type PageStatus, type Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPage, seedPerson, type SeedPage } from '@uw/db/test-seed';
import { personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { writePageAsAgent } from './agent-write.ts';
import { createPage, updatePage } from './store.ts';

const EDITOR = { id: '00000000-0000-4000-8000-000000002a01', email: 'derive@unfoldingword.org' };
const AREA = '80-89';
const OLDER = '00000000-0000-4000-8000-000000002a11';
const RETIRED = '00000000-0000-4000-8000-000000002a12';

const persona = {
  identity: 'agent:iterate',
  owner: `human:${EDITOR.id}`,
  harness: '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11',
  toolset: ['read_page', 'query_entities'],
  run_shape: 'workflow-run',
  engine: 'openrouter-messages',
  model: 'glm-5.3-flash',
  provider: 'z-ai',
  budget: { monthly_minor: 5000, currency: 'USD' },
  capability: 'build',
  requires_tools: ['write_page'],
};

const learning = (supersedes: string[]) => ({
  confidence: 'inferred',
  as_of: '2026-10-01',
  supersedes,
  review_by: null,
  contradicts: true,
});

async function editor(db: Database): Promise<Principal> {
  await seedPerson(db, EDITOR);
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000002a02',
    personId: EDITOR.id,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: AREA,
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  return personOn(db, EDITOR.id, EDITOR.email, new Date());
}

async function deviceOf(db: Database): Promise<Principal> {
  const human = await editor(db);
  return principalSchema.parse({
    ...human,
    identity: `agent:${EDITOR.id}/laptop`,
    kind: 'agent',
    email: null,
  });
}

function create(
  db: Database,
  person: Principal,
  page: { type: string; frontmatter: Page['frontmatter']; status: PageStatus },
) {
  const pageId = crypto.randomUUID();
  const command = {
    command: 'create_page' as const,
    requestId: crypto.randomUUID(),
    pageId,
    jdArea: AREA,
    slug: `derived-${pageId.slice(0, 8)}`,
    title: 'A derived page',
    parentId: null,
    bodyMd: 'Body.',
    ...page,
  };
  return createPage(db, person, command, crypto.randomUUID(), new Date());
}

function update(db: Database, person: Principal, page: Page, change: Partial<Page>) {
  const command = {
    command: 'update_page' as const,
    requestId: crypto.randomUUID(),
    pageId: page.id,
    expectedVersion: page.version,
    slug: page.slug,
    title: page.title,
    parentId: page.parentId,
    frontmatter: page.frontmatter,
    bodyMd: page.bodyMd,
    status: page.status,
    ...change,
  };
  return updatePage(db, person, command, crypto.randomUUID(), new Date());
}

function pageOf(result: Awaited<ReturnType<typeof createPage>>): Page {
  if (!result.ok) throw new Error(`the write was refused: ${result.reason}`);
  return result.page;
}

async function storedRow(db: Database, pageId: string) {
  const rows = await db.execute<{
    status: string;
    version: number;
    frontmatter: Page['frontmatter'];
  }>(sql`SELECT status, version, frontmatter FROM pages WHERE id = ${pageId}`);
  return rows[0] ?? null;
}

function seededLearning(id: string, status: PageStatus): SeedPage {
  return {
    id,
    type: 'learning',
    status,
    jdArea: AREA,
    slug: `older-${id.slice(-4)}`,
    title: 'An older learning',
    bodyMd: 'What we thought.',
    frontmatter: learning([]),
  };
}

async function statusFollowsThePage(db: Database): Promise<void> {
  const person = await editor(db);
  const draft = pageOf(
    await create(db, person, { type: 'persona', frontmatter: persona, status: 'draft' }),
  );
  expect(draft.frontmatter['status']).toBe('draft');
  const suggested = pageOf(await update(db, person, draft, { status: 'suggested' }));
  expect(suggested.frontmatter['status']).toBe('suggested');
  const retired = pageOf(await update(db, person, suggested, { status: 'retired' }));
  expect((await storedRow(db, retired.id))?.frontmatter['status']).toBe('retired');
}

async function namedStatusIsRefused(db: Database): Promise<void> {
  const person = await editor(db);
  const named = { ...persona, status: 'active' };
  const created = await create(db, person, {
    type: 'persona',
    frontmatter: named,
    status: 'suggested',
  });
  expect(created).toMatchObject({ ok: false, reason: 'activation_required' });
  const page = pageOf(
    await create(db, person, { type: 'persona', frontmatter: persona, status: 'suggested' }),
  );
  expect(await update(db, person, page, { frontmatter: named })).toMatchObject({
    ok: false,
    reason: 'activation_required',
  });
  expect(await storedRow(db, page.id)).toMatchObject({ status: 'suggested', version: 1 });
}

async function toolsAreDerived(db: Database): Promise<void> {
  const person = await editor(db);
  const page = pageOf(
    await create(db, person, { type: 'persona', frontmatter: persona, status: 'draft' }),
  );
  expect(page.frontmatter['requires_tools']).toEqual(['read_page', 'query_entities']);
  const edited = { ...page.frontmatter, toolset: ['read_page'], requires_tools: ['approve'] };
  const saved = pageOf(await update(db, person, page, { frontmatter: edited }));
  expect(saved.frontmatter['requires_tools']).toEqual(['read_page']);
}

async function agentDraftLandsSuggested(db: Database): Promise<void> {
  const agent = await deviceOf(db);
  const pageId = crypto.randomUUID();
  const input = {
    pageId,
    type: 'persona' as const,
    jdArea: AREA,
    slug: 'persona-iterate',
    title: 'Iterate',
    parentId: null,
    frontmatter: persona,
    bodyMd: 'Instructions.',
    expectedVersion: null,
  };
  const request = {
    traceId: crypto.randomUUID(),
    at: new Date(),
    instructions: { namesInstructions: async () => false },
    writer: null,
  };
  const page = pageOf(await writePageAsAgent(db, agent, input, request));
  expect(page.status).toBe('suggested');
  expect(page.frontmatter).toMatchObject({
    status: 'suggested',
    requires_tools: ['read_page', 'query_entities'],
  });
}

async function supersedingFlags(db: Database): Promise<void> {
  const person = await editor(db);
  await seedPage(db, seededLearning(OLDER, 'active'));
  await seedPage(db, seededLearning(RETIRED, 'retired'));
  const page = pageOf(
    await create(db, person, {
      type: 'learning',
      frontmatter: learning([RETIRED, OLDER]),
      status: 'suggested',
    }),
  );
  expect(page.frontmatter['contradicts']).toBe(true);
}

async function retiredSupersedingDoesNotFlag(db: Database): Promise<void> {
  const person = await editor(db);
  await seedPage(db, seededLearning(RETIRED, 'retired'));
  const onlyRetired = pageOf(
    await create(db, person, {
      type: 'learning',
      frontmatter: learning([RETIRED]),
      status: 'suggested',
    }),
  );
  expect(onlyRetired.frontmatter['contradicts']).toBe(false);
  const nothing = pageOf(
    await create(db, person, { type: 'learning', frontmatter: learning([]), status: 'draft' }),
  );
  expect(nothing.frontmatter['contradicts']).toBe(false);
}

const activePersona = { ...persona, requires_tools: persona.toolset, status: 'active' };

async function seededActive(db: Database, slug: string): Promise<Page> {
  const page: Page = {
    id: crypto.randomUUID(),
    type: 'persona',
    jdArea: AREA,
    slug,
    title: 'Active',
    parentId: null,
    frontmatter: activePersona,
    bodyMd: 'Instructions.',
    version: 1,
    status: 'active',
  };
  const { id, type, status, jdArea, title, bodyMd, frontmatter } = page;
  await seedPage(db, { id, type, status, jdArea, slug, title, bodyMd, frontmatter });
  return page;
}

async function activeEditReturnsToSuggested(db: Database): Promise<void> {
  const person = await editor(db);
  const page = await seededActive(db, 'persona-active');
  const retitled = pageOf(await update(db, person, page, { title: 'Still active' }));
  expect(retitled.status).toBe('active');
  const widened = { ...activePersona, toolset: [...persona.toolset, 'write_page'] };
  const saved = pageOf(await update(db, person, retitled, { frontmatter: widened }));
  expect(saved.status).toBe('suggested');
  expect(saved.frontmatter['status']).toBe('suggested');
  const other = await seededActive(db, 'persona-instructed');
  const instructed = pageOf(await update(db, person, other, { bodyMd: 'New instructions.' }));
  expect(instructed.status).toBe('suggested');
  expect(instructed.frontmatter['status']).toBe('suggested');
}

describe.skipIf(!testServer)('the page writer derives persona and learning fields', () => {
  it("PE-1 a persona page's frontmatter status follows the page's status on every write", () =>
    withAppDatabase(statusFollowsThePage));

  it('PE-1 a write whose persona frontmatter names another status is refused activation_required', () =>
    withAppDatabase(namedStatusIsRefused));

  it('PE-2 requires_tools is derived from the toolset and an edited value is replaced', () =>
    withAppDatabase(toolsAreDerived));

  it('PE-2 a persona an agent drafts through write_page lands suggested with requires_tools derived', () =>
    withAppDatabase(agentDraftLandsSuggested));

  it('PE-8 a learning that supersedes an unretired learning is flagged as a contradiction', () =>
    withAppDatabase(supersedingFlags));

  it('PE-8 a learning that supersedes only retired learnings, or nothing, is not flagged', () =>
    withAppDatabase(retiredSupersedingDoesNotFlag));

  it("PE-3 an editor's save that changes an active persona's toolset or instructions returns it to suggested", () =>
    withAppDatabase(activeEditReturnsToSuggested));
});
