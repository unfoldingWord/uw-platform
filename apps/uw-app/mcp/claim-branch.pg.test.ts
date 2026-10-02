import { afterAll, describe, expect, it } from 'vitest';
import type { HarnessEvent, Principal } from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { readAllEvents, software, type Caller, type Kernel } from '@uw/harness';
import { systemClock } from '../ports/clock.ts';
import { platformStore } from '../ports/store.ts';
import { agentOf, kernelOn, noFacts, personOn } from '../testing/kernel.ts';
import type { VerbContext } from './context.ts';
import { callVerb } from './dispatch.ts';
import { verbHandlers } from './verbs/index.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';
const OWNER = {
  id: '00000000-0000-4000-8000-000000003201',
  email: 'branch-owner@unfoldingword.org',
};
const pullRequest = { repo: 'unfoldingWord/uw-platform', number: 7 };
const HEAD = 'a'.repeat(40);

type Rig = {
  readonly db: Database;
  readonly kernel: Kernel;
  readonly ian: Principal;
  readonly agent: Principal;
  readonly harnessId: string;
  readonly drop: () => Promise<void>;
};

let rigged: Promise<Rig> | null = null;

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

function value<T>(outcome: { status: 'accepted'; value: T } | { status: 'error'; reason: string }) {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

async function seedOwner(db: Database): Promise<void> {
  await seedPerson(db, OWNER);
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000003211',
    personId: OWNER.id,
    role: 'admin',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
}

async function openRig(): Promise<Rig> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  await seedOwner(db);
  const kernel = kernelOn(db, systemClock, { githubFacts: noFacts });
  const ian = await personOn(db, IAN_ID, 'ian.lindsley@unfoldingword.org', new Date());
  const owner = await personOn(db, OWNER.id, OWNER.email, new Date());
  const harnessId = crypto.randomUUID();
  value(
    await kernel.stages.activate(caller(ian), {
      harnessId,
      harnessKey: 'software',
      jdArea: '80-89',
      template: software,
      repository: 'unfoldingWord/uw-platform',
    }),
  );
  const drop = async () => {
    await db.$client.end();
    await database.drop();
  };
  return { db, kernel, ian, agent: agentOf(owner, 'laptop'), harnessId, drop };
}

function rig(): Promise<Rig> {
  rigged ??= openRig();
  return rigged;
}

afterAll(async () => {
  if (rigged !== null) await (await rigged).drop();
});

async function enqueued(r: Rig): Promise<string> {
  const input = { harnessId: r.harnessId, title: 'branch', pageId: null, priority: 1 };
  const { itemId } = value(
    await r.kernel.items.enqueue(caller(r.ian), { ...input, due: null, delegationId: null }),
  );
  return itemId;
}

async function atScope(r: Rig, change: { pullRequest: typeof pullRequest; head: string } | null) {
  const itemId = await enqueued(r);
  value(await r.kernel.items.claim(caller(r.ian), { itemId, delegationId: null }));
  value(await r.kernel.items.submit(caller(r.ian), { itemId, to: null, evidence: {}, change }));
  return itemId;
}

function contextFor(r: Rig): VerbContext {
  return {
    principal: r.agent,
    host: 'external',
    at: new Date(),
    traceId: crypto.randomUUID(),
    kernel: r.kernel,
    db: r.db,
    commit: 'test-commit',
    logger: createLogger(
      { traceId: 'trace', commit: 'test-commit', route: 'POST /mcp', principal: null },
      () => undefined,
    ),
  };
}

async function claimed(r: Rig, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await callVerb(contextFor(r), 'claim_item', args, verbHandlers);
  const block = result.content[0];
  return block?.type === 'text' ? JSON.parse(block.text) : {};
}

function eventsOf(r: Rig, itemId: string): Promise<readonly HarnessEvent[]> {
  return platformStore(r.db).transaction((tx) => readAllEvents(tx, r.harnessId, itemId));
}

describe.skipIf(!testServer)(
  'GH-4 claim_item names the branch and the commit to start from',
  () => {
    it('answers harness/<item> and the expected head the last submit recorded', async () => {
      const r = await rig();
      const itemId = await atScope(r, { pullRequest, head: HEAD });
      expect(await claimed(r, { itemId, delegationId: null })).toMatchObject({
        itemId,
        branch: { name: `harness/${itemId}`, startFrom: HEAD, adopted: false },
      });
    });

    it('answers no commit to start from when nothing was submitted with a head', async () => {
      const r = await rig();
      const itemId = await atScope(r, null);
      expect(await claimed(r, { itemId, delegationId: null })).toMatchObject({
        branch: { name: `harness/${itemId}`, startFrom: null, adopted: false },
      });
    });

    it('refuses to adopt when no branch was abandoned and records nothing', async () => {
      const r = await rig();
      const itemId = await atScope(r, { pullRequest, head: HEAD });
      const before = await eventsOf(r, itemId);
      expect(await claimed(r, { itemId, delegationId: null, adoptBranch: true })).toEqual({
        status: 'error',
        reason: 'malformed_command',
        detail: { adoptBranch: true, why: 'no_abandoned_branch' },
      });
      expect(await eventsOf(r, itemId)).toEqual(before);
    });
  },
);
