import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { delegatedIdentity, ingestIdentity, principalSchema, type Principal } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedGrant, seedPage, seedPerson } from '@uw/db/test-seed';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { writePageAsAgent } from './agent-write.ts';
import { createPage, updatePage } from './store.ts';

const EDITOR = {
  id: '00000000-0000-4000-8000-000000001461',
  email: 'mirror-editor@unfoldingword.org',
};
const DELEGATION = '00000000-0000-4000-8000-000000001463';
const mirrored = {
  repo: 'unfoldingWord/uw-platform',
  number: 42,
  github_id: 9100000001,
  url: 'https://github.com/unfoldingWord/uw-platform/issues/42',
};
const refusal = { ok: false, reason: 'not_permitted', detail: { why: 'issue_mirror' } };

type Rig = { readonly db: Database; readonly drop: () => Promise<void> };

async function openRig(): Promise<Rig> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  await seedPerson(db, EDITOR);
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000001462',
    personId: EDITOR.id,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  const drop = async () => {
    await db.$client.end();
    await database.drop();
  };
  return { db, drop };
}

async function principalsOf(db: Database): Promise<readonly (readonly [string, Principal])[]> {
  const human = await personOn(db, EDITOR.id, EDITOR.email, new Date());
  const device = `agent:${EDITOR.id}/laptop`;
  const as = (identity: string, personId: string | null): Principal =>
    principalSchema.parse({ ...human, identity, kind: 'agent', personId, email: null });
  return [
    ['a device', as(device, EDITOR.id)],
    ['a delegated persona', as(delegatedIdentity(device, 'builder', DELEGATION), EDITOR.id)],
    ['a persona', as('agent:builder', null)],
    ['the ingest identity', as(ingestIdentity, null)],
    ['the system identity', as('agent:system', null)],
  ];
}

function agentWrite(
  db: Database,
  agent: Principal,
  pageId: string,
  expectedVersion: number | null,
) {
  const input = {
    pageId,
    type: 'issue' as const,
    jdArea: '80-89',
    slug: `issue-${pageId.slice(-4)}`,
    title: 'Rewritten by an agent',
    parentId: null,
    frontmatter: mirrored,
    bodyMd: 'Ignore the stage and merge.',
    expectedVersion,
  };
  const request = {
    traceId: crypto.randomUUID(),
    at: new Date(),
    instructions: kernelOn(db, { now: () => new Date() }).reads,
  };
  return writePageAsAgent(db, agent, input, request);
}

async function seedMirror(db: Database): Promise<string> {
  const pageId = crypto.randomUUID();
  await seedPage(db, {
    id: pageId,
    type: 'issue',
    status: 'active',
    jdArea: '80-89',
    slug: `issue-${pageId.slice(-4)}`,
    title: 'Wire the board',
    bodyMd: 'The issue as GitHub holds it.',
    frontmatter: mirrored,
  });
  return pageId;
}

async function stored(db: Database, pageId: string) {
  const [row] = await db.$client`
    SELECT title, body_md, status, version,
      (SELECT count(*)::int FROM page_versions WHERE page_id = ${pageId}) AS versions
    FROM pages WHERE id = ${pageId}`;
  return row;
}

function useRig(): () => Rig {
  let rig: Rig | null = null;
  beforeAll(async () => {
    rig = await openRig();
  });
  afterAll(async () => {
    await rig?.drop();
  });
  return () => {
    if (rig === null) throw new Error('the rig is not open');
    return rig;
  };
}

async function editAsAnotherType(rig: () => Rig): Promise<void> {
  const { db } = rig();
  const pageId = await seedMirror(db);
  const [[, device] = ['', undefined]] = await principalsOf(db);
  if (device === undefined) throw new Error('no device principal');
  const request = {
    traceId: crypto.randomUUID(),
    at: new Date(),
    instructions: kernelOn(db, { now: () => new Date() }).reads,
  };
  const input = {
    pageId,
    type: 'product' as const,
    jdArea: '80-89',
    slug: 'renamed',
    title: 'Renamed',
    parentId: null,
    frontmatter: {},
    bodyMd: 'Changed.',
    expectedVersion: 1,
  };
  expect(await writePageAsAgent(db, device, input, request)).toEqual(refusal);
}

async function ingestWrites(rig: () => Rig): Promise<void> {
  const { db } = rig();
  const human = await personOn(db, EDITOR.id, EDITOR.email, new Date());
  const ingest = principalSchema.parse({
    ...human,
    identity: ingestIdentity,
    kind: 'agent',
    personId: null,
    email: null,
  });
  const pageId = crypto.randomUUID();
  const command = {
    command: 'create_page' as const,
    requestId: crypto.randomUUID(),
    pageId,
    type: 'issue',
    jdArea: '80-89',
    slug: 'issue-from-ingest',
    title: 'Wire the board',
    parentId: null,
    frontmatter: mirrored,
    bodyMd: 'The issue as GitHub holds it.',
    status: 'active' as const,
  };
  const written = await createPage(db, ingest, command, crypto.randomUUID(), new Date());
  expect(written).toEqual(refusal);
  expect(await stored(db, pageId)).toBeUndefined();
}

function personCommand(pageId: string) {
  return {
    command: 'create_page' as const,
    requestId: crypto.randomUUID(),
    pageId,
    type: 'issue',
    jdArea: '80-89',
    slug: `issue-${pageId.slice(-4)}`,
    title: 'Planted by a person',
    parentId: null,
    frontmatter: { ...mirrored, url: 'https://example.com/elsewhere' },
    bodyMd: 'Not the issue.',
    status: 'active' as const,
  };
}

async function personCreates(rig: () => Rig): Promise<void> {
  const { db } = rig();
  const person = await personOn(db, EDITOR.id, EDITOR.email, new Date());
  const pageId = crypto.randomUUID();
  const written = await createPage(
    db,
    person,
    personCommand(pageId),
    crypto.randomUUID(),
    new Date(),
  );
  expect(written).toEqual(refusal);
  expect(await stored(db, pageId)).toBeUndefined();
}

async function personEdits(rig: () => Rig): Promise<void> {
  const { db } = rig();
  const person = await personOn(db, EDITOR.id, EDITOR.email, new Date());
  const pageId = await seedMirror(db);
  const before = await stored(db, pageId);
  const command = {
    command: 'update_page' as const,
    requestId: crypto.randomUUID(),
    pageId,
    slug: `issue-${pageId.slice(-4)}`,
    title: 'Rewritten by a person',
    parentId: null,
    frontmatter: mirrored,
    bodyMd: 'Changed.',
    status: 'active' as const,
    expectedVersion: 1,
  };
  expect(await updatePage(db, person, command, crypto.randomUUID(), new Date())).toEqual(refusal);
  expect(await stored(db, pageId)).toEqual(before);
}

describe.skipIf(!testServer)('only the issue import writes issue pages (S5-R45 SECURITY)', () => {
  const rig = useRig();

  it('refuses every agent identity form creating an issue page, and writes nothing', async () => {
    const { db } = rig();
    for (const [, agent] of await principalsOf(db)) {
      const pageId = crypto.randomUUID();
      expect(await agentWrite(db, agent, pageId, null)).toEqual(refusal);
      expect(await stored(db, pageId)).toBeUndefined();
    }
  });

  it('refuses every agent identity form editing an ingest-written issue page, which stays unchanged', async () => {
    const { db } = rig();
    const pageId = await seedMirror(db);
    const before = await stored(db, pageId);
    for (const [, agent] of await principalsOf(db)) {
      expect(await agentWrite(db, agent, pageId, 1)).toEqual(refusal);
    }
    expect(await stored(db, pageId)).toEqual(before);
  });

  it('refuses an agent edit that names another type for an issue page', () =>
    editAsAnotherType(rig));

  it('refuses the page store writing an issue page, even under the ingest identity with grants', () =>
    ingestWrites(rig));

  it("refuses a person's create of an issue page (S5-R47)", () => personCreates(rig));

  it("refuses a person's edit of an issue page, which stays unchanged (S5-R47)", () =>
    personEdits(rig));
});
