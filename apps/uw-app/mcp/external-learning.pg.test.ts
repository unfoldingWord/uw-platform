import { afterAll, describe, expect, it } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { sql } from 'drizzle-orm';
import {
  createPageCommandSchema,
  defaultCiChecks,
  type CapabilityWord,
  type Principal,
} from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedActivePersona, seedGrant, seedPerson } from '@uw/db/test-seed';
import { software, type Caller, type Kernel } from '@uw/harness';
import { createApp } from '../app.tsx';
import { createPage } from '../pages/store.ts';
import { systemClock } from '../ports/clock.ts';
import { createAccessFixture, type AccessFixture } from '../testing/access-keys.ts';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { callTool, httpClient } from '../testing/mcp.ts';
import { postgresDeps } from '../testing/postgres.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';
const SETH = {
  id: '00000000-0000-4000-8000-000000002701',
  email: 'bench-seth@unfoldingword.org',
  grant: '00000000-0000-4000-8000-000000002711',
};

type Rig = {
  readonly db: Database;
  readonly fixture: AccessFixture;
  readonly kernel: Kernel;
  readonly ian: Principal;
  readonly drop: () => Promise<void>;
};
type Bench = { readonly harnessId: string; readonly repository: string };
type Frontmatter = Record<string, unknown>;

let rigged: Promise<Rig> | null = null;

async function openRig(): Promise<Rig> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  await seedPerson(db, { id: SETH.id, email: SETH.email });
  await seedGrant(db, {
    id: SETH.grant,
    personId: SETH.id,
    role: 'admin',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  const ian = await personOn(db, IAN_ID, 'ian.lindsley@unfoldingword.org', new Date());
  const drop = async () => {
    await db.$client.end();
    await database.drop();
  };
  return { db, fixture: await createAccessFixture(), kernel: kernelOn(db, systemClock), ian, drop };
}

function rig(): Promise<Rig> {
  rigged ??= openRig();
  return rigged;
}

afterAll(async () => {
  if (rigged !== null) await (await rigged).drop();
});

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

function value<T>(outcome: { status: 'accepted'; value: T } | { status: 'error'; reason: string }) {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

async function benchHarness(r: Rig): Promise<Bench> {
  const harnessId = crypto.randomUUID();
  const key = `bench-${harnessId.slice(0, 8)}`;
  const repository = `unfoldingWord/${key}`;
  const activate = {
    harnessId,
    harnessKey: key,
    jdArea: '80-89',
    template: software,
    repository,
    requiredChecks: [...defaultCiChecks],
  };
  value(await r.kernel.stages.activate(caller(r.ian), activate));
  return { harnessId, repository };
}

async function runner(
  r: Rig,
  bench: Bench,
  capability: CapabilityWord,
  persona: string,
): Promise<Client> {
  const seth = await personOn(r.db, SETH.id, SETH.email, new Date());
  const identity = `agent:${persona}`;
  const grant = {
    harnessId: bench.harnessId,
    persona: identity,
    expiresAt: null,
    supersedes: null,
  };
  const delegation = value(
    await r.kernel.delegations.grant(caller(seth), { ...grant, capability, maxTier: null }),
  );
  await seedActivePersona(r.db, {
    identity,
    harnessId: bench.harnessId,
    frontmatter: { capability },
  });
  const token = await r.fixture.signForMcp({ email: SETH.email });
  return httpClient(createApp(postgresDeps(r.db, r.fixture)), {
    'cf-access-jwt-assertion': token,
    'x-uw-device': 'bench',
    'x-uw-persona': persona,
    'x-uw-delegation': delegation.id,
  });
}

function pageOf(pageId: string, frontmatter: Frontmatter) {
  return {
    pageId,
    type: 'learning',
    jdArea: '80-89',
    slug: `bench-${pageId.slice(0, 8)}`,
    title: 'Migrations that skip the down step come back',
    parentId: null,
    frontmatter: {
      confidence: 'observed',
      as_of: '2026-10-15',
      supersedes: [],
      review_by: null,
      ...frontmatter,
    },
    bodyMd: 'Three reviews this week asked for the down migration.',
  };
}

function learning(pageId: string, frontmatter: Frontmatter, expectedVersion: number | null = null) {
  return { ...pageOf(pageId, frontmatter), expectedVersion };
}

async function stored(r: Rig, pageId: string) {
  const rows = await r.db.execute<{ status: string; frontmatter: Frontmatter }>(
    sql`SELECT status, frontmatter FROM pages WHERE id = ${pageId}`,
  );
  return rows[0] ?? null;
}

async function landsExternal(): Promise<void> {
  const r = await rig();
  const bench = await benchHarness(r);
  const client = await runner(r, bench, 'review', 'reviewer');
  const pageId = crypto.randomUUID();
  const pull = { repo: bench.repository, number: 7 };
  const written = await callTool(client, 'write_page', learning(pageId, { pull_request: pull }));
  expect(written.isError).toBe(false);
  expect(await stored(r, pageId)).toMatchObject({
    status: 'suggested',
    frontmatter: { source: 'external', pull_request: pull },
  });
}

async function refusesUnnamed(): Promise<void> {
  const r = await rig();
  const bench = await benchHarness(r);
  const client = await runner(r, bench, 'review', 'reviewer');
  const bare = await callTool(client, 'write_page', learning(crypto.randomUUID(), {}));
  const elsewhere = await callTool(
    client,
    'write_page',
    learning(crypto.randomUUID(), {
      pull_request: { repo: 'unfoldingWord/uw-platform', number: 7 },
    }),
  );
  expect([bare.body['reason'], elsewhere.body['reason']]).toEqual([
    'malformed_command',
    'not_permitted',
  ]);
}

async function otherCapabilityIsPlatform(): Promise<void> {
  const r = await rig();
  const bench = await benchHarness(r);
  const client = await runner(r, bench, 'iterate', 'iterate');
  const plain = crypto.randomUUID();
  expect((await callTool(client, 'write_page', learning(plain, {}))).isError).toBe(false);
  expect((await stored(r, plain))?.frontmatter).toMatchObject({ source: 'platform' });
  const claimed = await callTool(
    client,
    'write_page',
    learning(crypto.randomUUID(), { source: 'external' }),
  );
  expect(claimed.body['reason']).toBe('malformed_command');
}

async function editKeepsProvenance(): Promise<void> {
  const r = await rig();
  const bench = await benchHarness(r);
  const client = await runner(r, bench, 'review', 'reviewer');
  const pageId = crypto.randomUUID();
  const pull = { repo: bench.repository, number: 7 };
  await callTool(client, 'write_page', learning(pageId, { pull_request: pull }));
  const moved = await callTool(
    client,
    'write_page',
    learning(pageId, { pull_request: { ...pull, number: 8 } }, 1),
  );
  expect(moved.body['reason']).toBe('malformed_command');
  const kept = await callTool(
    client,
    'write_page',
    learning(pageId, { pull_request: pull, confidence: 'confirmed' }, 1),
  );
  expect(kept.isError).toBe(false);
  expect((await stored(r, pageId))?.frontmatter).toMatchObject({
    source: 'external',
    confidence: 'confirmed',
  });
}

async function personCannotClaim(): Promise<void> {
  const r = await rig();
  const page = pageOf(crypto.randomUUID(), {
    source: 'external',
    pull_request: { repo: 'unfoldingWord/x', number: 1 },
  });
  const command = createPageCommandSchema.parse({
    command: 'create_page',
    requestId: crypto.randomUUID(),
    ...page,
    status: 'suggested',
  });
  const created = await createPage(r.db, r.ian, command, crypto.randomUUID(), new Date());
  expect(created).toMatchObject({ ok: false, reason: 'malformed_command' });
}

describe.skipIf(!testServer)('PI-2 the bench posts its rulings as suggested learnings', () => {
  it(
    'PI-2 a learning from an external runner on a review delegation lands suggested, external, with its pull request',
    landsExternal,
  );
  it(
    'PI-2 refuses an external learning without its pull request or from another repository',
    refusesUnnamed,
  );
  it(
    'PI-2 a runner on another capability writes a platform learning and cannot claim external',
    otherCapabilityIsPlatform,
  );
  it('PI-2 an edit keeps the source and the pull request', editKeepsProvenance);
  it('PI-2 a person cannot mark a learning external through the page API', personCannotClaim);
});
