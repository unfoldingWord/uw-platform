import { setTimeout as pause } from 'node:timers/promises';
import type { Principal } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { lockWaiters } from '@uw/db/store';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedPage } from '@uw/db/test-seed';
import { software, type Caller, type KernelOutcome } from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { kernelOn, personasOn, personOn } from '../testing/kernel.ts';

const ianId = '00000000-0000-4000-8000-000000000001';
const firstPage = '00000000-0000-4000-8000-000000009911';
const secondPage = '00000000-0000-4000-8000-000000009912';
const clock = { now: () => new Date() };

type Race = {
  readonly one: Database;
  readonly two: Database;
  readonly holder: Database;
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

function builderPage(id: string, slug: string, harnessId: string) {
  return {
    id,
    type: 'persona' as const,
    status: 'suggested' as const,
    jdArea: '80-89',
    slug,
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
  };
}

async function raceOn(one: Database, two: Database, holder: Database): Promise<Race> {
  const ian = await personOn(one, ianId, 'ian.lindsley@unfoldingword.org', new Date());
  const harnessId = crypto.randomUUID();
  const activated = await kernelOn(one, clock).stages.activate(caller(ian), {
    harnessId,
    harnessKey: 'software',
    jdArea: '80-89',
    template: software,
    repository: null,
  });
  if (activated.status !== 'accepted') throw new Error(`activate refused: ${activated.reason}`);
  await seedPage(one, builderPage(firstPage, 'persona-builder', harnessId));
  await seedPage(one, builderPage(secondPage, 'persona-builder-twin', harnessId));
  return { one, two, holder, ian, harnessId };
}

async function withRace(work: (race: Race) => Promise<void>): Promise<void> {
  const database = await createMigratedDatabase(testServer ?? '');
  const clients = [0, 1, 2].map(() => createClient(database.connectionString));
  const [one, two, holder] = clients;
  try {
    if (!one || !two || !holder) throw new Error('three connections expected');
    await work(await raceOn(one, two, holder));
  } finally {
    await Promise.all(clients.map((db) => db.$client.end()));
    await database.drop();
  }
}

async function waitersReach(race: Race, count: number, settled: () => boolean): Promise<void> {
  for (let waited = 0; waited < 3_000; waited += 20) {
    if (settled() || (await lockWaiters(race.holder)) >= count) return;
    await pause(20);
  }
  expect.fail(`no activation settled and fewer than ${count} waited on a lock`);
}

function holdFirstPageRow(race: Race) {
  let locked = (): void => undefined;
  const held = new Promise<void>((resolve) => void (locked = resolve));
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => void (release = resolve));
  const done = race.holder.$client.begin(async (sql) => {
    await sql`SELECT id FROM pages WHERE id = ${firstPage} FOR UPDATE`;
    locked();
    await released;
  });
  return { held, release, done };
}

async function activateBoth(race: Race): Promise<readonly KernelOutcome<unknown>[]> {
  const row = holdFirstPageRow(race);
  await row.held;
  const activate = (db: Database, pageId: string) =>
    personasOn(db, clock).activate(caller(race.ian), {
      pageId,
      expectedVersion: 1,
      harnessId: race.harnessId,
    });
  const first = activate(race.one, firstPage);
  await waitersReach(race, 1, () => false);
  let secondSettled = false;
  const second = activate(race.two, secondPage).finally(() => void (secondSettled = true));
  try {
    await waitersReach(race, 2, () => secondSettled);
  } finally {
    row.release();
    await row.done;
  }
  return Promise.all([first, second]);
}

async function activePages(race: Race): Promise<number> {
  const rows = await race.holder.$client`
    SELECT count(*)::int AS active FROM pages
    WHERE type = 'persona' AND status = 'active' AND frontmatter->>'identity' = 'agent:builder'`;
  return Number(rows[0]?.['active']);
}

async function oneIdentityOnePage(race: Race): Promise<void> {
  const outcomes = await activateBoth(race);
  const accepted = outcomes.filter((outcome) => outcome.status === 'accepted');
  expect(accepted).toHaveLength(1);
  expect(outcomes).toContainEqual({
    status: 'error',
    reason: 'not_permitted',
    detail: { why: 'identity_in_use' },
  });
  expect(await activePages(race)).toBe(1);
}

describe.skipIf(!testServer)('DX-6 two persona pages naming one identity activated at once', () => {
  it('leaves exactly one page active and refuses the other identity_in_use', () =>
    withRace(oneIdentityOnePage));
});
