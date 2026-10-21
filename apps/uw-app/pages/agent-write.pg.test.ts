import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { principalSchema, type Principal } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { lockWaiters } from '@uw/db/store';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { activateSeededPage, seedGrant, seedPage, seedPerson } from '@uw/db/test-seed';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { awaitBlocked } from '../../../packages/harness/port-contracts/lock-wait.ts';
import { writePageAsAgent } from './agent-write.ts';

const EDITOR = {
  id: '00000000-0000-4000-8000-000000001451',
  email: 'racing-editor@unfoldingword.org',
};
const learningFrontmatter = {
  confidence: 'observed',
  as_of: '2026-10-01',
  supersedes: [],
  review_by: null,
};

type Rig = { readonly db: Database; readonly connectionString: string };

async function storedPage(r: Rig, pageId: string) {
  const [row] = await r.db.$client`
    SELECT status, version,
      (SELECT count(*)::int FROM page_versions WHERE page_id = ${pageId}) AS versions
    FROM pages WHERE id = ${pageId}`;
  return row;
}

async function deviceOf(db: Database, person: typeof EDITOR): Promise<Principal> {
  const human = await personOn(db, person.id, person.email, new Date());
  return principalSchema.parse({
    ...human,
    identity: `agent:${person.id}/laptop`,
    kind: 'agent',
    email: null,
  });
}

async function seedSuggested(db: Database): Promise<string> {
  const pageId = crypto.randomUUID();
  await seedPage(db, {
    id: pageId,
    type: 'learning',
    status: 'suggested',
    jdArea: '80-89',
    slug: 'racing-learning',
    title: 'A seeded page',
    bodyMd: 'The racing notes.',
    frontmatter: learningFrontmatter,
  });
  return pageId;
}

function activation(db: Database, pageId: string) {
  return db.transaction(async (tx) => {
    await activateSeededPage(tx, pageId);
    return { ok: true };
  });
}

function agentSave(db: Database, agent: Principal, pageId: string) {
  const input = {
    pageId,
    type: 'learning' as const,
    jdArea: '80-89',
    slug: 'racing-learning',
    title: 'Overwritten by an agent',
    parentId: null,
    frontmatter: learningFrontmatter,
    bodyMd: 'The agent was here.',
    expectedVersion: 1,
  };
  const request = {
    traceId: crypto.randomUUID(),
    at: new Date(),
    instructions: kernelOn(db, { now: () => new Date() }).reads,
    writer: null,
  };
  return writePageAsAgent(db, agent, input, request);
}

type Connections = {
  readonly person: Database;
  readonly agent: Database;
  readonly holder: Database;
};

async function raceBehindARowLock(r: Rig, c: Connections, pageId: string) {
  const agent = await deviceOf(c.agent, EDITOR);
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => void (release = resolve));
  let locked = (): void => undefined;
  const rowLocked = new Promise<void>((resolve) => void (locked = resolve));
  const holding = c.holder.$client.begin(async (sql) => {
    await sql`SELECT id FROM pages WHERE id = ${pageId} FOR UPDATE`;
    locked();
    await released;
  });
  await rowLocked;
  try {
    const activated = activation(c.person, pageId);
    await awaitBlocked(async () => ((await lockWaiters(r.db)) >= 1 ? 1 : 0));
    const saved = agentSave(c.agent, agent, pageId);
    await awaitBlocked(async () => ((await lockWaiters(r.db)) >= 2 ? 1 : 0));
    release();
    return { activated: await activated, saved: await saved };
  } finally {
    release();
    await holding;
  }
}

async function withConnections(r: Rig, work: (c: Connections) => Promise<void>): Promise<void> {
  const c = {
    person: createClient(r.connectionString),
    agent: createClient(r.connectionString),
    holder: createClient(r.connectionString),
  };
  try {
    await work(c);
  } finally {
    await Promise.all(Object.values(c).map((db) => db.$client.end()));
  }
}

async function openRig(): Promise<Rig & { readonly drop: () => Promise<void> }> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  await seedPerson(db, EDITOR);
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000001452',
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
  return { db, connectionString: database.connectionString, drop };
}

describe.skipIf(!testServer)(
  "AB-5 an agent's save racing a person's activation never undoes it",
  () => {
    let rig: Awaited<ReturnType<typeof openRig>> | null = null;
    beforeAll(async () => {
      rig = await openRig();
    });
    afterAll(async () => {
      await rig?.drop();
    });

    it('keeps the activation when the agent saves the version the person just replaced', async () => {
      if (rig === null) throw new Error('the rig is not open');
      const r = rig;
      const pageId = await seedSuggested(r.db);
      await withConnections(r, async (c) => {
        const { activated, saved } = await raceBehindARowLock(r, c, pageId);
        expect(activated.ok).toBe(true);
        expect(saved).toMatchObject({ ok: false, reason: 'stale_version' });
      });
      expect(await storedPage(r, pageId)).toEqual({ status: 'active', version: 2, versions: 0 });
    });
  },
);
