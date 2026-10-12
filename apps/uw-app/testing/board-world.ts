import { randomUUID } from 'node:crypto';
import type { Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import {
  rewriteItem,
  rewriteStagePaused,
  seedGrant,
  seedPerson,
  seedRunRow,
} from '@uw/db/test-seed';
import { software, type Clock, type Kernel, type Template } from '@uw/harness';
import { accepted, callerOf } from './commands.ts';
import { agentOf, kernelOn, personOn } from './kernel.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';
const IAN_EMAIL = 'ian.lindsley@unfoldingword.org';
const HOUR = 3_600_000;

type Seeded = { readonly email: string; readonly id: string };

export type BoardWorld = {
  readonly db: Database;
  readonly harnessId: string;
  readonly ian: Principal;
  readonly ianEmail: string;
  readonly viewer: Seeded;
  readonly stranger: Seeded;
  readonly subscribed: string;
  readonly metered: string;
  readonly personHeld: string;
  readonly unheld: string;
  readonly leaseUntil: Date;
};

async function seededPerson(
  db: Database,
  name: string,
  role: 'admin' | 'editor' | 'viewer',
  area: string,
): Promise<Seeded> {
  const id = randomUUID();
  const email = `${name}@unfoldingword.org`;
  await seedPerson(db, { id, email });
  await seedGrant(db, {
    id: randomUUID(),
    personId: id,
    role,
    scopeKind: 'jd_area',
    scopeArea: area,
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  return { id, email };
}

export async function activatedHarness(
  kernel: Kernel,
  ian: Principal,
  template: Template = software,
  harnessKey = 'software',
): Promise<string> {
  const harnessId = randomUUID();
  accepted(
    await kernel.stages.activate(callerOf(ian), {
      harnessId,
      harnessKey,
      jdArea: '80-89',
      template,
      repository: null,
    }),
  );
  return harnessId;
}

export async function enqueuedItem(
  kernel: Kernel,
  ian: Principal,
  harnessId: string,
  title: string,
): Promise<string> {
  const enqueued = await kernel.items.enqueue(callerOf(ian), {
    harnessId,
    title,
    pageId: null,
    priority: 1,
    due: null,
    delegationId: null,
  });
  return accepted(enqueued).itemId;
}

export async function advanced(
  kernel: Kernel,
  ian: Principal,
  itemId: string,
  stages: number,
): Promise<void> {
  for (let n = 0; n < stages; n += 1) {
    accepted(await kernel.items.claim(callerOf(ian), { itemId, delegationId: null }));
    accepted(
      await kernel.items.submit(callerOf(ian), { itemId, to: null, evidence: {}, change: null }),
    );
  }
}

function stepOf(tokensIn: number, tokensOut: number, at: Date) {
  return {
    step: 'work',
    tokensIn,
    tokensOut,
    costMinor: null,
    computeMinor: null,
    model: 'claude-sonnet-5',
    resolvedProvider: 'anthropic',
    toolsCalled: [],
    writes: 0,
    at: at.toISOString(),
  };
}

type RunSeed = { readonly harnessId: string; readonly itemId: string; readonly at: Date };

export async function subscriptionRun(db: Database, seed: RunSeed, persona: string) {
  await seedRunRow(db, {
    id: randomUUID(),
    harnessId: seed.harnessId,
    itemId: seed.itemId,
    persona,
    runShape: 'external-run',
    engine: 'external',
    model: 'claude-sonnet-5',
    costBasis: 'subscription',
    traceId: randomUUID(),
    outcome: 'completed',
    steps: [stepOf(900, 300, seed.at)],
    startedAt: seed.at,
    endedAt: seed.at,
  });
}

export async function meteredRun(db: Database, seed: RunSeed, outcome: 'running' | 'completed') {
  await seedRunRow(db, {
    id: randomUUID(),
    harnessId: seed.harnessId,
    itemId: seed.itemId,
    persona: 'agent:builder',
    runShape: 'workflow-run',
    engine: 'claude-messages',
    model: 'claude-sonnet-5',
    pinnedProvider: 'anthropic',
    costBasis: 'metered',
    costMinor: 120,
    computeMinor: 30,
    traceId: randomUUID(),
    outcome,
    steps: [stepOf(2000, 1000, seed.at)],
    startedAt: seed.at,
    endedAt: outcome === 'running' ? null : seed.at,
  });
}

export async function heldByAgent(
  db: Database,
  itemId: string,
  holder: string,
  until: Date,
): Promise<void> {
  await rewriteItem(db, itemId, { claimedBy: holder, claimantKind: 'agent', leaseExpires: until });
}

async function pausedStage(db: Database, harnessId: string, key: string): Promise<void> {
  await rewriteStagePaused(db, { harnessId, key }, true);
}

export function ianOn(db: Database, at: Date): Promise<Principal> {
  return personOn(db, IAN_ID, IAN_EMAIL, at);
}

async function items(kernel: Kernel, ian: Principal, harnessId: string) {
  const unheld = await enqueuedItem(kernel, ian, harnessId, 'Draw the icon');
  const personHeld = await enqueuedItem(kernel, ian, harnessId, 'Review the copy');
  await advanced(kernel, ian, personHeld, 1);
  accepted(await kernel.items.claim(callerOf(ian), { itemId: personHeld, delegationId: null }));
  const subscribed = await enqueuedItem(kernel, ian, harnessId, 'Write the run notes');
  await advanced(kernel, ian, subscribed, 3);
  const laptop = agentOf(ian, 'laptop');
  accepted(await kernel.items.claim(callerOf(laptop), { itemId: subscribed, delegationId: null }));
  const metered = await enqueuedItem(kernel, ian, harnessId, 'Wire the run host');
  await advanced(kernel, ian, metered, 3);
  return { unheld, personHeld, subscribed, metered, laptop };
}

export async function boardWorld(db: Database, clock: Clock): Promise<BoardWorld> {
  const at = clock.now();
  const ian = await ianOn(db, at);
  const kernel = kernelOn(db, clock);
  const harnessId = await activatedHarness(kernel, ian);
  const seeded = await items(kernel, ian, harnessId);
  await subscriptionRun(db, { harnessId, itemId: seeded.subscribed, at }, seeded.laptop.identity);
  await meteredRun(db, { harnessId, itemId: seeded.metered, at }, 'running');
  const leaseUntil = new Date(at.getTime() + 4 * HOUR);
  await heldByAgent(db, seeded.metered, 'agent:builder', leaseUntil);
  await heldByAgent(db, seeded.subscribed, seeded.laptop.identity, leaseUntil);
  await pausedStage(db, harnessId, 'check');
  return {
    db,
    harnessId,
    ian,
    ianEmail: IAN_EMAIL,
    viewer: await seededPerson(db, 'board-viewer', 'viewer', '80-89'),
    stranger: await seededPerson(db, 'board-stranger', 'viewer', '20-29'),
    subscribed: seeded.subscribed,
    metered: seeded.metered,
    personHeld: seeded.personHeld,
    unheld: seeded.unheld,
    leaseUntil,
  };
}
