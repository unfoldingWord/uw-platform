import type { Principal } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { lockWaiters } from '@uw/db/store';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedPage } from '@uw/db/test-seed';
import { software, type Caller, type Grants, type KernelOutcome } from '@uw/harness';
import { awaitBlocked } from '@uw/harness/port-contracts/lock-wait';
import { describe, expect, it } from 'vitest';
import { platformGrants } from '../ports/grants.ts';
import { kernelOn, personasOn, personOn } from '../testing/kernel.ts';

const ianId = '00000000-0000-4000-8000-000000000001';
const pageId = '00000000-0000-4000-8000-000000009901';
const clock = { now: () => new Date() };

type Flip = {
  readonly first: Database;
  readonly second: Database;
  readonly ian: Principal;
  readonly harnessId: string;
};

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

const instructions = [
  '---',
  'name: builder',
  'description: Builder turns an approved plan into commits.',
  '---',
  'Claim the item, do the work, submit it.',
].join('\n');

async function flipOn(first: Database, second: Database): Promise<Flip> {
  const ian = await personOn(first, ianId, 'ian.lindsley@unfoldingword.org', new Date());
  const harnessId = crypto.randomUUID();
  const activated = await kernelOn(first, clock).stages.activate(caller(ian), {
    harnessId,
    harnessKey: 'software',
    jdArea: '80-89',
    template: software,
    repository: null,
  });
  if (activated.status !== 'accepted') throw new Error(`activate refused: ${activated.reason}`);
  await seedPage(first, {
    id: pageId,
    type: 'persona',
    status: 'suggested',
    jdArea: '80-89',
    slug: 'persona-builder',
    title: 'Builder',
    bodyMd: instructions,
    frontmatter: {
      identity: 'agent:builder',
      owner: `human:${ianId}`,
      harness: harnessId,
      toolset: ['read_page'],
      run_shape: 'workflow-run',
      engine: 'claude-messages',
      model: 'claude-sonnet-5',
      provider: null,
      budget: { monthly_minor: 0, currency: 'USD' },
      capability: 'build',
      requires_tools: ['read_page'],
      status: 'suggested',
    },
  });
  return { first, second, ian, harnessId };
}

async function withFlip(work: (flip: Flip) => Promise<void>): Promise<void> {
  const database = await createMigratedDatabase(testServer ?? '');
  const first = createClient(database.connectionString);
  const second = createClient(database.connectionString);
  try {
    await work(await flipOn(first, second));
  } finally {
    await Promise.all([first.$client.end(), second.$client.end()]);
    await database.drop();
  }
}

function heldGrants(grants: Grants, reached: () => void, resume: Promise<void>): Grants {
  return {
    ...grants,
    lockAndReread: async (tx, personId, at) => {
      const locked = await grants.lockAndReread(tx, personId, at);
      reached();
      await resume;
      return locked;
    },
  };
}

async function activateTwice(flip: Flip): Promise<readonly KernelOutcome<unknown>[]> {
  let reached = (): void => undefined;
  const atLock = new Promise<void>((resolve) => void (reached = resolve));
  let resume = (): void => undefined;
  const resumed = new Promise<void>((resolve) => void (resume = resolve));
  const paused = personasOn(flip.first, clock, {
    grants: heldGrants(platformGrants(flip.first), reached, resumed),
  });
  const input = { pageId, expectedVersion: 1, harnessId: flip.harnessId };
  const held = paused.activate(caller(flip.ian), input);
  await atLock;
  const other = personasOn(flip.second, clock).activate(caller(flip.ian), input);
  await awaitBlocked(() => lockWaiters(flip.first));
  resume();
  return Promise.all([held, other]);
}

async function counted(flip: Flip) {
  const rows = await flip.first.$client`
    SELECT
      (SELECT count(*)::int FROM harness_events WHERE name = 'persona_activated') AS activated,
      (SELECT count(*)::int FROM personas WHERE page_id = ${pageId}) AS projected,
      (SELECT version FROM pages WHERE id = ${pageId}) AS version`;
  return rows[0];
}

async function oneActivationWins(flip: Flip): Promise<void> {
  const [held, other] = await activateTwice(flip);
  expect(held?.status).toBe('accepted');
  expect(other).toMatchObject({ status: 'error' });
  expect(['stale_version', 'not_permitted']).toContain(
    other?.status === 'error' ? other.reason : null,
  );
  expect(await counted(flip)).toEqual({ activated: 1, projected: 1, version: 2 });
}

describe.skipIf(!testServer)('DX-6 two activations of one persona page at once', () => {
  it('PE-3 two activations of one page at once record exactly one persona_activated', () =>
    withFlip(oneActivationWins));
});
