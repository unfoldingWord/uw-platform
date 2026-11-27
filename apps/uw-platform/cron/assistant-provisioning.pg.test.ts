import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { createKernel, type Kernel } from '@uw/harness';
import { platformKernelSettings } from '../assistants/area.ts';
import { directMessagesOf } from '../assistants/direct-messages.ts';
import type { Bindings } from '../env.ts';
import { platformPorts } from '../kernel.ts';
import { allEvents } from '../testing/commands.ts';
import { personOn } from '../testing/kernel.ts';
import type { CronDeps } from './job.ts';
import { minuteJob } from './minute.ts';
import { deleteTurnedOffAssistantsJob } from './assistant-deletion.ts';

type Line = Record<string, unknown>;

const anaId = '00000000-0000-4000-8000-0000000e1601';
const start = new Date();
const DAY_MS = 86_400_000;

function kernelAt(db: Database, at: Date): Kernel {
  const handle = { db, ping: async () => undefined, release: async () => undefined };
  return createKernel(
    { ...platformPorts(handle), clock: { now: () => at } },
    platformKernelSettings,
  );
}

function depsAt(at: Date, lines: Line[]): CronDeps {
  return {
    now: () => at,
    fetch: () => Promise.reject(new Error('no network here')),
    sink: (line) => lines.push(JSON.parse(line) as Line),
    newId: () => randomUUID(),
    commit: 'c',
    engines: {
      AI_GATEWAY_ACCOUNT_ID: 'account',
      AI_GATEWAY_ID: 'gateway',
      AI_GATEWAY_ANALYTICS_TOKEN: 'analytics',
      fetch: () => Promise.reject(new Error('no spend read here')),
    },
    directMessages: directMessagesOf,
  };
}

async function anaOn(db: Database) {
  await seedPerson(db, { id: anaId, email: 'ana@unfoldingword.org' });
  await seedGrant(db, {
    id: randomUUID(),
    personId: anaId,
    role: 'viewer',
    scopeKind: 'jd_area',
    scopeArea: '30-39',
    grantedAt: new Date(start.getTime() - DAY_MS),
    expiresAt: null,
  });
  return personOn(db, anaId, 'ana@unfoldingword.org', start);
}

async function withDatabase(work: (db: Database, env: Bindings) => Promise<void>) {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  try {
    await work(db, { HYPERDRIVE: { connectionString: database.connectionString } });
  } finally {
    await db.$client.end();
    await database.drop();
  }
}

async function namesTheMissingWorkspace(db: Database, env: Bindings): Promise<void> {
  const ana = await anaOn(db);
  const caller = { actor: ana, traceId: randomUUID(), requestId: null };
  const on = await kernelAt(db, start).assistants.enable(caller, {
    harnessId: randomUUID(),
    name: 'barnabas',
  });
  if (on.status !== 'accepted') throw new Error(on.reason);
  const lines: Line[] = [];
  await minuteJob(env, depsAt(new Date(start.getTime() + 60_000), lines));
  const step = lines.filter((line) => line['step'] === 'assistant-provisioning');
  expect(step.map((line) => [line['outcome'], line['failed']])).toEqual([
    ['assistants_provisioned', 1],
  ]);
  const failures = (await allEvents(db, on.value.harnessId)).filter(
    (event) => event.name === 'assistant_provisioning_failed',
  );
  expect(failures.map((event) => event.evidence)).toEqual([
    { step: 'workspace_user', why: 'workspace_not_wired' },
  ]);
}

async function freesTheNumberAfterThirtyDays(db: Database, env: Bindings): Promise<void> {
  const ana = await anaOn(db);
  const caller = { actor: ana, traceId: randomUUID(), requestId: null };
  const on = await kernelAt(db, start).assistants.enable(caller, {
    harnessId: randomUUID(),
    name: 'barnabas',
  });
  if (on.status !== 'accepted') throw new Error(on.reason);
  await kernelAt(db, start).assistants.disable(caller, {});
  const lines: Line[] = [];
  await deleteTurnedOffAssistantsJob(env, depsAt(new Date(start.getTime() + 29 * DAY_MS), lines));
  await deleteTurnedOffAssistantsJob(env, depsAt(new Date(start.getTime() + 30 * DAY_MS), lines));
  const step = lines.filter((line) => line['step'] === 'assistant-deletion');
  expect(step.map((line) => [line['deleted'], line['failed']])).toEqual([
    [0, 0],
    [1, 0],
  ]);
  const deleted = (await allEvents(db, on.value.harnessId)).filter(
    (event) => event.name === 'assistant_deleted',
  );
  expect(deleted.map((event) => event.evidence)).toEqual([{ jdId: '10.51' }]);
}

describe.skipIf(!testServer)('PA-14 the crons that provision and delete assistants', () => {
  it('drives an assistant turned on in the minute job and names a missing Workspace', () =>
    withDatabase(namesTheMissingWorkspace));

  it('deletes an assistant 30 days after it was turned off and frees its number nightly', () =>
    withDatabase(freesTheNumberAfterThirtyDays));
});
