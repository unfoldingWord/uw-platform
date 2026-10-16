import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { principalSchema, type Page, type PageType, type Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPage, seedPerson } from '@uw/db/test-seed';
import { createApp } from '../app.tsx';
import {
  createAccessFixture,
  fixtureAccessEnv,
  type AccessFixture,
} from '../testing/access-keys.ts';
import { personOn } from '../testing/kernel.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';
import { writePageAsAgent } from './agent-write.ts';
import { confirmPage } from './confirm.ts';
import { updatePage } from './store.ts';

const EDITOR = { id: '00000000-0000-4000-8000-000000002b01', email: 'confirm@unfoldingword.org' };
const AREA = '80-89';

let fixture: AccessFixture;

beforeAll(async () => {
  fixture = await createAccessFixture();
});

const frontmatterByType = new Map<PageType, Page['frontmatter']>([
  ['skill', { name: 'write-notes', description: 'Draft notes.' }],
  [
    'learning',
    {
      confidence: 'observed',
      as_of: '2026-10-01',
      supersedes: [],
      review_by: null,
      contradicts: false,
    },
  ],
  [
    'persona',
    {
      identity: 'agent:builder',
      owner: `human:${EDITOR.id}`,
      harness: '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11',
      toolset: ['read_page'],
      run_shape: 'workflow-run',
      engine: 'openrouter-messages',
      model: 'glm-5.3-flash',
      budget: { monthly_minor: 5000, currency: 'USD' },
      capability: 'build',
      requires_tools: ['read_page'],
      status: 'suggested',
    },
  ],
  ['product', { owner: `human:${EDITOR.id}`, summary: 'A product page.' }],
]);

async function editor(db: Database): Promise<Principal> {
  await seedPerson(db, EDITOR);
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000002b02',
    personId: EDITOR.id,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: AREA,
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  return personOn(db, EDITOR.id, EDITOR.email, new Date());
}

function agentOf(person: Principal): Principal {
  return principalSchema.parse({
    ...person,
    identity: `agent:${EDITOR.id}/laptop`,
    kind: 'agent',
    email: null,
  });
}

async function seeded(db: Database, type: PageType, status: 'suggested' | 'active' = 'suggested') {
  const id = crypto.randomUUID();
  await seedPage(db, {
    id,
    type,
    status,
    jdArea: AREA,
    slug: `${type}-${id.slice(0, 8)}`,
    title: `A ${type}`,
    bodyMd: 'Body.',
    frontmatter: frontmatterByType.get(type) ?? {},
  });
  return id;
}

function confirm(db: Database, actor: Principal, pageId: string, expectedVersion = 1) {
  const command = {
    command: 'confirm_page' as const,
    requestId: crypto.randomUUID(),
    pageId,
    expectedVersion,
  };
  return confirmPage(db, actor, command, crypto.randomUUID(), new Date());
}

async function stored(db: Database, pageId: string) {
  const rows = await db.execute<{ status: string; version: number }>(
    sql`SELECT status, version FROM pages WHERE id = ${pageId}`,
  );
  const versions = await db.execute<{ edit_source: string }>(
    sql`SELECT edit_source FROM page_versions WHERE page_id = ${pageId} ORDER BY version`,
  );
  return { ...rows[0], editSources: versions.map((row) => row.edit_source) };
}

async function confirmOverHttp(db: Database, pageId: string): Promise<number> {
  const token = await fixture.sign({ email: EDITOR.email });
  const response = await createApp(postgresDeps(db, fixture)).request(
    '/api/pages/commands/confirm_page',
    {
      method: 'POST',
      headers: { 'cf-access-jwt-assertion': token, 'content-type': 'application/json' },
      body: JSON.stringify({
        command: 'confirm_page',
        requestId: crypto.randomUUID(),
        pageId,
        expectedVersion: 1,
      }),
    },
    fixtureAccessEnv,
  );
  return response.status;
}

async function personConfirms(db: Database): Promise<void> {
  const person = await editor(db);
  const learning = await seeded(db, 'learning');
  expect(await confirm(db, person, learning)).toMatchObject({
    ok: true,
    page: { id: learning, status: 'active', version: 2 },
  });
  expect(await stored(db, learning)).toEqual({
    status: 'active',
    version: 2,
    editSources: [`human:${EDITOR.id}`],
  });
  const skill = await seeded(db, 'skill');
  expect(await confirmOverHttp(db, skill)).toBe(200);
  expect(await stored(db, skill)).toMatchObject({ status: 'active', version: 2 });
}

async function staleConfirmationRefused(db: Database): Promise<void> {
  const person = await editor(db);
  const learning = await seeded(db, 'learning');
  expect(await confirm(db, person, learning, 2)).toMatchObject({
    ok: false,
    reason: 'stale_version',
  });
  expect(await stored(db, learning)).toEqual({
    status: 'suggested',
    version: 1,
    editSources: [],
  });
}

async function agentCannotConfirm(db: Database): Promise<void> {
  const agent = agentOf(await editor(db));
  for (const type of ['learning', 'skill'] as const) {
    const pageId = await seeded(db, type);
    expect(await confirm(db, agent, pageId)).toMatchObject({
      ok: false,
      reason: 'not_permitted',
    });
    expect(await stored(db, pageId)).toMatchObject({ status: 'suggested', version: 1 });
  }
  const active = await seeded(db, 'learning', 'active');
  const input = {
    pageId: active,
    type: 'learning' as const,
    jdArea: AREA,
    slug: `learning-${active.slice(0, 8)}`,
    title: 'Rewritten',
    parentId: null,
    frontmatter: frontmatterByType.get('learning') ?? {},
    bodyMd: 'Rewritten.',
    expectedVersion: 1,
  };
  const request = {
    traceId: crypto.randomUUID(),
    at: new Date(),
    instructions: { namesInstructions: async () => false },
    writer: null,
  };
  expect(await writePageAsAgent(db, agent, input, request)).toEqual({
    ok: false,
    reason: 'not_permitted',
    detail: { why: 'gated_page' },
  });
}

async function onlyConfirmationActivates(db: Database): Promise<void> {
  const person = await editor(db);
  const learning = await seeded(db, 'learning');
  const command = {
    command: 'update_page' as const,
    requestId: crypto.randomUUID(),
    pageId: learning,
    expectedVersion: 1,
    slug: `learning-${learning.slice(0, 8)}`,
    title: 'A learning',
    parentId: null,
    frontmatter: frontmatterByType.get('learning') ?? {},
    bodyMd: 'Body.',
    status: 'active' as const,
  };
  const saved = await updatePage(db, person, command, crypto.randomUUID(), new Date());
  expect(saved).toMatchObject({ ok: false, reason: 'activation_required' });
  expect(await stored(db, learning)).toMatchObject({ status: 'suggested', version: 1 });
  expect(await confirm(db, person, learning)).toMatchObject({ ok: true });
}

async function personaIsActivatedNotConfirmed(db: Database): Promise<void> {
  const person = await editor(db);
  const persona = await seeded(db, 'persona');
  expect(await confirm(db, person, persona)).toEqual({
    ok: false,
    reason: 'not_permitted',
    detail: { why: 'persona_needs_activation' },
  });
  const product = await seeded(db, 'product');
  expect(await confirm(db, person, product)).toEqual({
    ok: false,
    reason: 'malformed_command',
    detail: { why: 'not_confirmable' },
  });
  expect(await stored(db, persona)).toMatchObject({ status: 'suggested', version: 1 });
}

describe.skipIf(!testServer)('a person confirms a learning or a skill', () => {
  it('PE-8 a person confirms a suggested learning at the version they read', () =>
    withAppDatabase(personConfirms));

  it('PE-8 a confirmation at a stale version is refused stale_version and changes nothing', () =>
    withAppDatabase(staleConfirmationRefused));

  it('PE-8 an agent cannot confirm a learning or a skill', () =>
    withAppDatabase(agentCannotConfirm));

  it('PE-8 confirmation is the only way a learning becomes active', () =>
    withAppDatabase(onlyConfirmationActivates));

  it('PE-8 a persona is not confirmed but activated', () =>
    withAppDatabase(personaIsActivatedNotConfirmed));
});
