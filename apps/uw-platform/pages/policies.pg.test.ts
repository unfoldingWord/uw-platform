import { describe, expect, it } from 'vitest';
import { principalSchema, type Page, type PageStatus, type Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { cascadePlacements, pageLinks } from '@uw/db/schema';
import { seedGrant, seedPage, seedPerson, type SeedPage } from '@uw/db/test-seed';
import { personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { writePageAsAgent } from './agent-write.ts';
import { confirmPage } from './confirm.ts';
import { contextPolicies, policyChainFor } from './policies.ts';
import { createPage, updatePage } from './store.ts';

const EDITOR = { id: '00000000-0000-4000-8000-000000002b01', email: 'policies@unfoldingword.org' };
const AREA = '00-09';
const HIDDEN_AREA = '10-19';
const NODE = {
  portfolio: '00000000-0000-4000-8000-000000002b11',
  program: '00000000-0000-4000-8000-000000002b12',
  project: '00000000-0000-4000-8000-000000002b13',
  product: '00000000-0000-4000-8000-000000002b14',
  productChild: '00000000-0000-4000-8000-000000002b15',
  otherProgram: '00000000-0000-4000-8000-000000002b16',
  knowledge: '00000000-0000-4000-8000-000000002b17',
};
const ON = new Date('2026-12-01T12:00:00.000Z');
const NISO = '## Need\nN.\n## Idea\nI.\n## Strategy\nS.\n## Outcomes\nO.\n## Risks\n## Roadmap\nR.';

function seeded(id: string, type: SeedPage['type'], change: Partial<SeedPage> = {}): SeedPage {
  return {
    id,
    type,
    status: 'active',
    jdArea: AREA,
    bodyMd: '',
    slug: `policy-${id.slice(-4)}`,
    title: `Page ${id.slice(-4)}`,
    ...change,
  };
}

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
  return personOn(db, EDITOR.id, EDITOR.email, ON);
}

function agentOf(person: Principal): Principal {
  return principalSchema.parse({
    ...person,
    identity: `agent:${EDITOR.id}/laptop`,
    kind: 'agent',
    email: null,
  });
}

async function seedCascade(db: Database): Promise<void> {
  await seedPage(db, seeded(NODE.portfolio, 'portfolio'));
  await seedPage(db, seeded(NODE.program, 'program'));
  await seedPage(db, seeded(NODE.otherProgram, 'program'));
  await seedPage(db, seeded(NODE.project, 'project'));
  await seedPage(db, seeded(NODE.product, 'product'));
  await seedPage(
    db,
    seeded(NODE.productChild, 'system_goal', {
      parentId: NODE.product,
      frontmatter: { statement: 'S.', measure: 'M.', horizon: '2027-01-01' },
    }),
  );
  await db.insert(pageLinks).values([
    { fromPage: NODE.project, toPage: NODE.program, rel: 'project.program', position: 'a' },
    { fromPage: NODE.program, toPage: NODE.portfolio, rel: 'program.portfolio', position: 'a' },
  ]);
  const placed = { placedBy: `human:${EDITOR.id}`, placedAt: ON };
  await db.insert(cascadePlacements).values({
    entityKind: 'page',
    entityId: NODE.product,
    cascadePageId: NODE.project,
    ...placed,
  });
}

type Draft = {
  readonly type: 'policy' | 'charter';
  readonly frontmatter: Page['frontmatter'];
  readonly bodyMd?: string;
  readonly status?: PageStatus;
  readonly jdArea?: string;
};

function command(draft: Draft) {
  const pageId = crypto.randomUUID();
  return {
    command: 'create_page' as const,
    requestId: crypto.randomUUID(),
    pageId,
    jdArea: draft.jdArea ?? AREA,
    slug: `p-${pageId.slice(0, 8)}`,
    title: `A ${draft.type}`,
    parentId: null,
    bodyMd: draft.bodyMd ?? 'Body.',
    frontmatter: { ...draft.frontmatter },
    status: draft.status ?? 'draft',
    type: draft.type,
  };
}

async function activePolicy(db: Database, frontmatter: Readonly<Record<string, unknown>>) {
  const id = crypto.randomUUID();
  await seedPage(db, seeded(id, 'policy', { frontmatter: { ...frontmatter } }));
  return id;
}

const from = { effective_from: '2026-01-01' };

const create = (db: Database, person: Principal, draft: Draft) =>
  createPage(db, person, command(draft), crypto.randomUUID(), ON);

const pointedAt = (target: string): Draft => ({
  type: 'policy',
  frontmatter: { enforcement: 'default', applies_to: target, ...from },
});

async function targetMustBeANodeOrProduct(db: Database): Promise<void> {
  const person = await editor(db);
  await seedCascade(db);
  await seedPage(db, seeded(NODE.knowledge, 'skill'));
  const refused = { ok: false, reason: 'applies_to_not_found' };
  expect(await create(db, person, pointedAt(NODE.knowledge))).toMatchObject(refused);
  expect(await create(db, person, pointedAt(crypto.randomUUID()))).toMatchObject(refused);
  expect(await create(db, person, pointedAt(NODE.program))).toMatchObject({ ok: true });
}

async function unreadableTargetIsMissing(db: Database): Promise<void> {
  const person = await editor(db);
  const hidden = crypto.randomUUID();
  await seedPage(db, seeded(hidden, 'program', { jdArea: HIDDEN_AREA }));
  expect(await create(db, person, pointedAt(hidden))).toMatchObject({
    ok: false,
    reason: 'applies_to_not_found',
  });
}

async function charterNeedsNiso(db: Database): Promise<void> {
  const person = await editor(db);
  await seedCascade(db);
  const charter = (bodyMd: string): Draft => ({
    type: 'charter',
    frontmatter: { applies_to: NODE.project },
    bodyMd,
  });
  expect(await create(db, person, charter('## Need\nN.'))).toMatchObject({
    ok: false,
    reason: 'charter_sections_missing',
    detail: { missing: ['Idea', 'Strategy', 'Outcomes', 'Risks', 'Roadmap'] },
  });
  const made = await create(db, person, charter(NISO));
  if (!made.ok) throw new Error(made.reason);
  const { page } = made;
  const save = {
    command: 'update_page' as const,
    requestId: crypto.randomUUID(),
    pageId: page.id,
    expectedVersion: 1,
    slug: page.slug,
    title: page.title,
    parentId: null,
    frontmatter: page.frontmatter,
    bodyMd: NISO.replace('## Risks', ''),
    status: 'draft' as const,
  };
  expect(await updatePage(db, person, save, crypto.randomUUID(), ON)).toMatchObject({
    ok: false,
    reason: 'charter_sections_missing',
  });
}

function agentInput() {
  const pageId = crypto.randomUUID();
  return {
    pageId,
    type: 'policy' as const,
    jdArea: AREA,
    slug: `agent-policy-${pageId.slice(0, 8)}`,
    title: 'An agent policy',
    parentId: null,
    frontmatter: { enforcement: 'required', ...from },
    bodyMd: 'Proposed.',
    expectedVersion: null,
  };
}

async function agentSuggestsAndPersonConfirms(db: Database): Promise<void> {
  const person = await editor(db);
  const agent = agentOf(person);
  const request = {
    traceId: crypto.randomUUID(),
    at: ON,
    instructions: { namesInstructions: () => Promise.resolve(false) },
    writer: null,
  };
  const input = agentInput();
  const made = await writePageAsAgent(db, agent, input, request);
  if (!made.ok) throw new Error(made.reason);
  expect(made.page.status).toBe('suggested');
  const confirm = {
    command: 'confirm_page' as const,
    requestId: crypto.randomUUID(),
    pageId: made.page.id,
    expectedVersion: made.page.version,
  };
  const confirmed = await confirmPage(db, person, confirm, crypto.randomUUID(), ON);
  expect(confirmed).toMatchObject({ ok: true, page: { status: 'active' } });
  const edit = { ...input, bodyMd: 'Rewritten by an agent.', expectedVersion: 2 };
  expect(await writePageAsAgent(db, agent, edit, request)).toMatchObject({
    ok: false,
    reason: 'not_permitted',
  });
}

describe.skipIf(!testServer)('PO-1 policy and charter pages are checked on save', () => {
  it('refuses a policy that applies to a page that is not a node or a product', () =>
    withAppDatabase(targetMustBeANodeOrProduct));

  it('refuses a policy whose target the writer cannot read, as if it were missing', () =>
    withAppDatabase(unreadableTargetIsMissing));

  it('refuses a charter without the NISO sections, on create and on save', () =>
    withAppDatabase(charterNeedsNiso));

  it('lands an agent policy as suggested, refuses an agent edit once active, and a person confirms it', () =>
    withAppDatabase(agentSuggestsAndPersonConfirms));
});

async function chainThroughTheProduct(db: Database): Promise<void> {
  await seedCascade(db);
  const scope = { itemId: crypto.randomUUID(), itemPageId: NODE.productChild };
  expect(await policyChainFor(db, scope)).toEqual([
    { level: 'product', pageId: NODE.product },
    { level: 'project', pageId: NODE.project },
    { level: 'program', pageId: NODE.program },
    { level: 'portfolio', pageId: NODE.portfolio },
    { level: 'organization', pageId: null },
  ]);
}

async function itemPlacementFirst(db: Database): Promise<void> {
  await seedCascade(db);
  const itemId = crypto.randomUUID();
  await db.insert(cascadePlacements).values({
    entityKind: 'item',
    entityId: itemId,
    cascadePageId: NODE.otherProgram,
    placedBy: `human:${EDITOR.id}`,
    placedAt: ON,
  });
  expect(await policyChainFor(db, { itemId, itemPageId: NODE.product })).toEqual([
    { level: 'product', pageId: NODE.product },
    { level: 'program', pageId: NODE.otherProgram },
    { level: 'organization', pageId: null },
  ]);
  const unplaced = { itemId: crypto.randomUUID(), itemPageId: null };
  expect(await policyChainFor(db, unplaced)).toEqual([{ level: 'organization', pageId: null }]);
}

async function seedPolicies(db: Database) {
  const orgWip = await activePolicy(db, { enforcement: 'default', ...from });
  const required = await activePolicy(db, { enforcement: 'required', ...from });
  const programWip = await activePolicy(db, {
    enforcement: 'default',
    applies_to: NODE.program,
    supersedes: [orgWip],
    ...from,
  });
  const sibling = await activePolicy(db, {
    enforcement: 'default',
    applies_to: NODE.otherProgram,
    ...from,
  });
  const hiddenFrontmatter = { enforcement: 'required', applies_to: NODE.product, ...from };
  const hidden = seeded(crypto.randomUUID(), 'policy', {
    jdArea: HIDDEN_AREA,
    frontmatter: hiddenFrontmatter,
  });
  await seedPage(db, hidden);
  const broken = crypto.randomUUID();
  await seedPage(db, seeded(broken, 'policy', { frontmatter: { enforcement: 'sometimes' } }));
  return { required, programWip, sibling, broken };
}

async function inForceAndReadable(db: Database): Promise<void> {
  const person = await editor(db);
  await seedCascade(db);
  const seededPolicies = await seedPolicies(db);
  const dropped: string[] = [];
  const scope = { itemId: crypto.randomUUID(), itemPageId: NODE.product };
  const policies = await contextPolicies(db, person, scope, ON, (id) => dropped.push(id));
  const shown = policies.map((policy) => [policy.page.id, policy.level, policy.enforcement]);
  expect(shown).toEqual([
    [seededPolicies.programWip, 'program', 'default'],
    [seededPolicies.required, 'organization', 'required'],
  ]);
  expect(dropped).toEqual([seededPolicies.broken]);
}

describe.skipIf(!testServer)('PO-3 the policies in force for an item, from its product up', () => {
  it('walks from the item page to its product, the product placement and the node parents', () =>
    withAppDatabase(chainThroughTheProduct));

  it('prefers the item own placement and stops where a node has no parent', () =>
    withAppDatabase(itemPlacementFirst));

  it('answers what is in force, most specific first, leaving out what the reader cannot read', () =>
    withAppDatabase(inForceAndReadable));
});
