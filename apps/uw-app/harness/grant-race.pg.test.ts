import { ciJobSchema, type ItemState, type Principal, defaultCiChecks } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { lockWaiters } from '@uw/db/store';
import {
  software,
  type Caller,
  type Clock,
  type Kernel,
  type KernelOutcome,
  type PullRequestFacts,
} from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { revokeRole } from '../acl/grant-commands.ts';
import { platformGrants } from '../ports/grants.ts';
import { listForDispatch } from '../testing/dispatch.ts';
import { agentOf, fixedFacts, kernelOn, pausingGrants, personOn } from '../testing/kernel.ts';
import { awaitBlocked } from '../../../packages/harness/port-contracts/lock-wait.ts';

const ianId = '00000000-0000-4000-8000-000000000001';
const kimId = '00000000-0000-4000-8000-000000000105';
const kimEmail = 'person5@unfoldingword.org';
const kimGrantId = '00000000-0000-4000-8000-000000020500';
const pauseMs = 1_500;
const instant = new Date();
const clock: Clock = { now: () => instant };

const head = 'a'.repeat(40);
const pullRequest = { repo: 'unfoldingWord/uw-platform', number: 42 };

function greenFacts(itemId: string): PullRequestFacts {
  return {
    ref: pullRequest,
    state: 'open',
    draft: false,
    head,
    headRef: `harness/${itemId}`,
    headRepo: pullRequest.repo,
    base: '0'.repeat(40),
    baseRef: 'main',
    defaultBranch: 'main',
    checks: ciJobSchema.options.map((name, index) => ({
      checkId: 9100000001 + index,
      name,
      headSha: head,
      app: 'github-actions',
      conclusion: 'success',
    })),
    reviews: [
      {
        reviewId: 9100000101,
        reviewer: 'uw-reviewer[bot]',
        commit: head,
        state: 'approved',
        provider: 'anthropic',
        findings: [],
        submittedAt: instant,
      },
    ],
    files: { head, base: '0'.repeat(40), paths: ['apps/uw-app/board.tsx'] },
    declaration: {
      closes: [],
      risks: 'none known',
      touches: 'the board',
      riskTier: 'standard',
      riskDomains: [],
    },
    closes: [],
    comparison: {
      head,
      base: '0'.repeat(40),
      behindBy: 0,
      patchId: 'b'.repeat(64),
      commits: [{ sha: head, merge: false, skipCi: false, closes: [] }],
      patchIds: { [head]: 'b'.repeat(64) },
    },
    freshAt: instant,
  };
}

type Race = {
  readonly connections: {
    readonly decider: Database;
    readonly revoker: Database;
    readonly observer: Database;
  };
  readonly decider: Kernel;
  readonly ian: Principal;
  readonly kim: Principal;
  readonly item: ItemState;
};

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

function accepted<T>(outcome: KernelOutcome<T>, what: string): T {
  if (outcome.status !== 'accepted') throw new Error(`${what} was refused: ${outcome.reason}`);
  return outcome.value;
}

async function passStage(kernel: Kernel, worker: Principal, itemId: string, change: boolean) {
  const as = caller(worker);
  accepted(await kernel.items.claim(as, { itemId, delegationId: null }), 'claim');
  const submitted = await kernel.items.submit(as, {
    itemId,
    to: null,
    evidence: {},
    change: change ? { pullRequest, head } : null,
  });
  return accepted(submitted, 'submit').item;
}

async function parkAtShip(db: Database, kernel: Kernel, ian: Principal): Promise<ItemState> {
  const harnessId = crypto.randomUUID();
  accepted(
    await kernel.stages.activate(caller(ian), {
      harnessId,
      harnessKey: 'software',
      jdArea: '80-89',
      template: software,
      repository: 'unfoldingWord/uw-platform',
      requiredChecks: [...defaultCiChecks],
    }),
    'activate',
  );
  await listForDispatch(db, 'unfoldingWord/uw-platform');
  const { itemId } = accepted(
    await kernel.items.enqueue(caller(ian), {
      harnessId,
      title: 'Show the board',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    }),
    'enqueue',
  );
  const agent = agentOf(ian, 'builder');
  await passStage(kernel, ian, itemId, false);
  await passStage(kernel, agent, itemId, false);
  await passStage(kernel, agent, itemId, false);
  await passStage(kernel, agent, itemId, true);
  await passStage(kernel, agent, itemId, true);
  const parked = await passStage(kernel, ian, itemId, false);
  if (parked.stageKey !== 'ship' || parked.gateStatus !== 'parked') {
    throw new Error(`the item is ${parked.gateStatus} at ${parked.stageKey}`);
  }
  return parked;
}

type Connections = Race['connections'];

async function raceOn(connections: Connections): Promise<Race> {
  await seedPerson(connections.decider, { id: kimId, email: kimEmail });
  await seedGrant(connections.decider, {
    id: kimGrantId,
    personId: kimId,
    role: 'admin',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: instant,
    expiresAt: null,
  });
  const ian = await personOn(connections.decider, ianId, 'ian.lindsley@unfoldingword.org', instant);
  const kim = await personOn(connections.decider, kimId, kimEmail, instant);
  const item = await parkAtShip(connections.decider, kernelOn(connections.decider, clock), ian);
  const facts = fixedFacts(greenFacts(item.itemId));
  const decider = kernelOn(connections.decider, clock, { githubFacts: facts });
  return { connections, decider, ian, kim, item };
}

async function withRace(work: (race: Race) => Promise<void>): Promise<void> {
  const database = await createMigratedDatabase(testServer ?? '');
  const connections = {
    decider: createClient(database.connectionString),
    revoker: createClient(database.connectionString),
    observer: createClient(database.connectionString),
  };
  try {
    await work(await raceOn(connections));
  } finally {
    await Promise.all(Object.values(connections).map((db) => db.$client.end()));
    await database.drop();
  }
}

function approve(item: ItemState) {
  return {
    itemId: item.itemId,
    decision: 'approve' as const,
    reason: null,
    findings: [],
    seenHead: item.expectedHead,
  };
}

function revokeKim(race: Race): Promise<unknown> {
  return revokeRole(
    race.connections.revoker,
    race.ian,
    { command: 'revoke_role', requestId: crypto.randomUUID(), grantId: kimGrantId },
    crypto.randomUUID(),
    instant,
  );
}

async function decisionRows(race: Race): Promise<number> {
  const rows = await race.connections.observer.$client`
    SELECT count(*)::int AS n FROM gate_decisions WHERE item_id = ${race.item.itemId}`;
  return Number(rows[0]?.n);
}

async function kimRevoked(race: Race): Promise<boolean> {
  const rows = await race.connections.observer.$client`
    SELECT revoked_at FROM role_grants WHERE id = ${kimGrantId}`;
  return rows[0]?.revoked_at !== null;
}

async function decideHoldingTheShareLock(race: Race) {
  let revoking: Promise<unknown> = Promise.resolve();
  let locked = (): void => undefined;
  const reachedLock = new Promise<void>((resolve) => void (locked = resolve));
  const decider = kernelOn(race.connections.decider, clock, {
    grants: pausingGrants(
      platformGrants(race.connections.decider),
      () => {
        revoking = revokeKim(race);
        locked();
      },
      pauseMs,
    ),
    githubFacts: fixedFacts(greenFacts(race.item.itemId)),
  });
  const deciding = decider.gates.decide(caller(race.kim), approve(race.item));
  await reachedLock;
  await awaitBlocked(() => lockWaiters(race.connections.observer));
  const outcome = await deciding;
  await revoking;
  return outcome;
}

describe.skipIf(!testServer)(
  'KN-14 DX-6 the grant re-read race, in both orders, on real connections',
  () => {
    it('refuses the decision when the revoke commits first', () =>
      withRace(async (race) => {
        await revokeKim(race);
        const outcome = await race.decider.gates.decide(caller(race.kim), approve(race.item));
        expect(outcome).toMatchObject({ status: 'error', reason: 'approver_lacks_domain_grant' });
        expect(await decisionRows(race)).toBe(0);
      }));

    it('records the decision when it holds the share lock first, and the revoke waits for it', () =>
      withRace(async (race) => {
        const outcome = await decideHoldingTheShareLock(race);
        expect(outcome.status).toBe('accepted');
        expect(await decisionRows(race)).toBe(1);
        expect(await kimRevoked(race)).toBe(true);
      }));
  },
);
