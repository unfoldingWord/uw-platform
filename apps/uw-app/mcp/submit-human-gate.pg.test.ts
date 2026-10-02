import { afterAll, describe, expect, it } from 'vitest';
import { delegatedIdentity, principalSchema, type Principal } from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { software, type Caller, type Kernel } from '@uw/harness';
import { systemClock } from '../ports/clock.ts';
import { agentOf, kernelOn, personOn } from '../testing/kernel.ts';
import type { VerbContext } from './context.ts';
import { callVerb } from './dispatch.ts';
import { verbHandlers } from './verbs/index.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';
const OWNER = {
  id: '00000000-0000-4000-8000-000000002901',
  email: 'gate-owner@unfoldingword.org',
};
const pullRequest = { repo: 'unfoldingWord/uw-platform', number: 7 };

type Rig = {
  readonly db: Database;
  readonly kernel: Kernel;
  readonly ian: Principal;
  readonly harnessId: string;
  readonly actors: ReadonlyMap<string, { principal: Principal; delegationId: string | null }>;
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

async function gatedHarness(kernel: Kernel, ian: Principal): Promise<string> {
  const harnessId = crypto.randomUUID();
  const activate = { harnessId, harnessKey: 'software', jdArea: '80-89', template: software };
  value(await kernel.stages.activate(caller(ian), activate));
  const change = { exitGate: 'human_approval' as const };
  value(await kernel.stages.updateStage(caller(ian), { harnessId, stageKey: 'check', change }));
  return harnessId;
}

async function actorsOf(kernel: Kernel, owner: Principal, harnessId: string) {
  const input = { harnessId, persona: 'agent:builder', capability: 'iterate' as const };
  const delegation = value(
    await kernel.delegations.grant(caller(owner), { ...input, expiresAt: null, supersedes: null }),
  );
  const delegated = principalSchema.parse({
    ...agentOf(owner, 'laptop'),
    identity: delegatedIdentity(`agent:${OWNER.id}/laptop`, 'builder', delegation.id),
  });
  return new Map([
    ['device', { principal: agentOf(owner, 'laptop'), delegationId: null }],
    ['delegated', { principal: delegated, delegationId: delegation.id }],
  ]);
}

async function openRig(): Promise<Rig> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  await seedPerson(db, OWNER);
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000002911',
    personId: OWNER.id,
    role: 'admin',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  const kernel = kernelOn(db, systemClock);
  const ian = await personOn(db, IAN_ID, 'ian.lindsley@unfoldingword.org', new Date());
  const owner = await personOn(db, OWNER.id, OWNER.email, new Date());
  const harnessId = await gatedHarness(kernel, ian);
  const actors = await actorsOf(kernel, owner, harnessId);
  const drop = async () => {
    await db.$client.end();
    await database.drop();
  };
  return { db, kernel, ian, harnessId, actors, drop };
}

function rig(): Promise<Rig> {
  rigged ??= openRig();
  return rigged;
}

afterAll(async () => {
  if (rigged !== null) await (await rigged).drop();
});

async function heldAtCheck(r: Rig, actor: string): Promise<string> {
  const held = r.actors.get(actor);
  if (held === undefined) throw new Error(`no actor ${actor}`);
  const input = { harnessId: r.harnessId, title: `gate ${actor}`, pageId: null, priority: 1 };
  const { itemId } = value(
    await r.kernel.items.enqueue(caller(r.ian), { ...input, due: null, delegationId: null }),
  );
  for (const stage of ['package', 'scope', 'plan', 'build']) {
    value(await r.kernel.items.claim(caller(r.ian), { itemId, delegationId: null }));
    const submit = { itemId, to: null, evidence: { stage }, change: null };
    value(await r.kernel.items.submit(caller(r.ian), submit));
  }
  const claim = { itemId, delegationId: held.delegationId };
  value(await r.kernel.items.claim(caller(held.principal), claim));
  return itemId;
}

function contextFor(r: Rig, principal: Principal): VerbContext {
  return {
    principal,
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

function replyOf(result: Awaited<ReturnType<typeof callVerb>>): Record<string, unknown> {
  const block = result.content[0];
  return block?.type === 'text' ? JSON.parse(block.text) : {};
}

async function stageOf(r: Rig, itemId: string): Promise<string> {
  return value(await r.kernel.reads.item(caller(r.ian), { itemId })).item.stageKey;
}

async function releaseIfHeld(
  r: Rig,
  held: { readonly principal: Principal; readonly delegationId: string | null },
  itemId: string,
): Promise<void> {
  const item = value(await r.kernel.reads.item(caller(r.ian), { itemId })).item;
  if (item.holder !== held.principal.identity) return;
  value(
    await r.kernel.items.release(caller(held.principal), {
      itemId,
      delegationId: held.delegationId,
    }),
  );
}

const attempts = [
  [{ to: null, pullRequest: null, head: null }, 'parked'],
  [{ to: 'ship', pullRequest: null, head: null }, 'parked'],
  [{ to: 'ship', pullRequest, head: 'abc1234' }, 'parked'],
  [{ to: null, pullRequest, head: 'abc1234' }, 'parked'],
  [{ to: 'ship', pullRequest, head: null }, 'malformed_command'],
  [{ to: 'merge', pullRequest: null, head: 'abc1234' }, 'malformed_command'],
] as const;

const cases = ['device', 'delegated'].flatMap((actor) =>
  attempts.map(([attempt, outcome]) => [actor, JSON.stringify(attempt), attempt, outcome] as const),
);

describe.skipIf(!testServer)(
  'AB-4 submit_to_gate through the MCP handler never passes a human gate',
  () => {
    it.each(cases)('keeps a %s agent at check for %s', async (actor, _shown, attempt, outcome) => {
      const r = await rig();
      const held = r.actors.get(actor);
      if (held === undefined) throw new Error(`no actor ${actor}`);
      const itemId = await heldAtCheck(r, actor);
      const args = { itemId, evidence: {}, ...attempt };
      const reply = replyOf(
        await callVerb(contextFor(r, held.principal), 'submit_to_gate', args, verbHandlers),
      );
      expect(reply['result'] ?? reply['reason']).toBe(outcome);
      expect(await stageOf(r, itemId)).toBe('check');
      await releaseIfHeld(r, held, itemId);
    });
  },
);
