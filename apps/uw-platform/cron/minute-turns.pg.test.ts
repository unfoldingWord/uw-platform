import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assistantIdentityOf, type Principal } from '@uw/contracts';
import { ingestPrincipal, systemPrincipal } from '@uw/core/principal';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { projectSeededPersona, seedPage } from '@uw/db/test-seed';
import {
  assistantPersonaDraft,
  createKernel,
  DEFAULT_SPEND_CAP,
  type Caller,
  type Kernel,
  type ModelEngine,
} from '@uw/harness';
import type { Bindings } from '../env.ts';
import { platformPorts } from '../kernel.ts';
import { directMessagesOf } from '../assistants/direct-messages.ts';
import { allEvents } from '../testing/commands.ts';
import { personOn } from '../testing/kernel.ts';
import type { CronDeps } from './job.ts';
import { minuteJob } from './minute.ts';

type Line = Record<string, unknown>;

const rowanId = '00000000-0000-4000-8000-000000000001';
const pageId = '00000000-0000-4000-8000-000000008a01';
const HOUR_MS = 60 * 60_000;
const start = new Date();

const quietEngine: ModelEngine = {
  turn: () => Promise.reject(new Error('no model turn runs here')),
  spend: async (since) => ({ spentMinor: 0, currency: 'USD', since, asOf: start }),
};

function caller(actor: Principal): Caller {
  return { actor, traceId: randomUUID(), requestId: null };
}

function accepted<T>(outcome: { status: string; value?: T; reason?: string }): T {
  if (outcome.status !== 'accepted' || outcome.value === undefined) {
    throw new Error(`refused: ${String(outcome.reason)}`);
  }
  return outcome.value;
}

function kernelOn(db: Database): Kernel {
  const handle = { db, ping: async () => undefined, release: async () => undefined };
  return createKernel(
    { ...platformPorts(handle), clock: { now: () => start }, modelEngine: quietEngine },
    { assistantsArea: '90-99', assistantSpendCapMinor: null, appOrigin: null },
  );
}

async function recorded(kernel: Kernel, externalId: string): Promise<string> {
  const { requestId } = accepted(
    await kernel.assistants.recordRequest(caller(ingestPrincipal()), {
      personId: rowanId,
      channel: 'zulip_dm',
      externalId,
      threadKey: 'dm',
      replyAddress: 'zulip:5001',
      receivedAt: start.toISOString(),
      note: 'What is next?',
      untrustedParts: [],
    }),
  );
  return requestId;
}

async function openTurnFor(db: Database, kernel: Kernel): Promise<string> {
  const rowan = await personOn(db, rowanId, 'rowan.test@unfoldingword.org', start);
  const provision = { harnessId: randomUUID(), personId: rowanId };
  const { harness } = accepted(await kernel.assistants.provision(caller(rowan), provision));
  const draft = assistantPersonaDraft(harness, rowan.identity);
  await seedPage(db, {
    id: pageId,
    type: 'persona',
    status: 'active',
    jdArea: harness.jdArea,
    slug: draft.slug,
    title: draft.title,
    bodyMd: draft.bodyMd,
    frontmatter: { ...draft.frontmatter, status: 'active' },
  });
  await projectSeededPersona(db, pageId);
  accepted(
    await kernel.delegations.grant(caller(rowan), {
      harnessId: harness.id,
      persona: assistantIdentityOf(rowanId),
      capability: 'assist',
      maxTier: null,
      expiresAt: null,
      supersedes: null,
    }),
  );
  accepted(
    await kernel.breaker.check(caller(systemPrincipal()), { ...DEFAULT_SPEND_CAP, since: start }),
  );
  const requestId = await recorded(kernel, '1801');
  const begin = { requestId, attemptId: randomUUID() };
  accepted(await kernel.assistants.beginTurn(caller(systemPrincipal()), begin));
  return harness.id;
}

function depsAt(at: Date, lines: Line[]): CronDeps {
  const spend = () =>
    Promise.resolve(
      Response.json({ data: { viewer: { accounts: [{ aiGatewayRequestsAdaptiveGroups: [] }] } } }),
    );
  return {
    now: () => at,
    fetch: () => Promise.reject(new Error('nothing but the spend read')),
    sink: (line) => lines.push(JSON.parse(line) as Line),
    newId: () => randomUUID(),
    commit: 'c',
    engines: {
      AI_GATEWAY_ACCOUNT_ID: 'account',
      AI_GATEWAY_ID: 'gateway',
      AI_GATEWAY_ANALYTICS_TOKEN: 'analytics',
      fetch: spend,
    },
    directMessages: directMessagesOf,
  };
}

async function closesACrashedTurn(): Promise<void> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  try {
    const harnessId = await openTurnFor(db, kernelOn(db));
    const env: Bindings = { HYPERDRIVE: { connectionString: database.connectionString } };
    const lines: Line[] = [];
    await minuteJob(env, depsAt(new Date(start.getTime() + HOUR_MS / 2), lines));
    await minuteJob(env, depsAt(new Date(start.getTime() + 2 * HOUR_MS), lines));
    await minuteJob(env, depsAt(new Date(start.getTime() + 2 * HOUR_MS + 60_000), lines));
    const finished = (await allEvents(db, harnessId)).filter(
      (event) => event.name === 'assistant_turn_finished',
    );
    expect(finished.map((event) => event.evidence['outcome'])).toEqual(['abandoned']);
    const swept = lines.filter((line) => line['step'] === 'assistant-turns');
    expect(swept.map((line) => [line['outcome'], line['abandoned']])).toEqual([
      ['assistant_turns_swept', 0],
      ['assistant_turns_swept', 1],
      ['assistant_turns_swept', 0],
    ]);
  } finally {
    await db.$client.end();
    await database.drop();
  }
}

async function startsAnUnstartedTurn(): Promise<void> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  try {
    const kernel = kernelOn(db);
    await openTurnFor(db, kernel);
    const waiting = await recorded(kernel, '1802');
    const created: string[] = [];
    const env: Bindings = {
      HYPERDRIVE: { connectionString: database.connectionString },
      ASSISTANT_TURN: {
        create: async ({ id }) => {
          if (created.includes(id)) throw new Error(`instance.already_exists ${id}`);
          created.push(id);
          return {};
        },
      },
    };
    const lines: Line[] = [];
    await minuteJob(env, depsAt(new Date(start.getTime() + 60_000), lines));
    await minuteJob(env, depsAt(new Date(start.getTime() + 3 * 60_000), lines));
    await minuteJob(env, depsAt(new Date(start.getTime() + 4 * 60_000), lines));
    expect(created).toEqual([waiting]);
    const starts = lines.filter((line) => line['step'] === 'assistant-starts');
    expect(starts.map((line) => [line['started'], line['already_started']])).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
    ]);
  } finally {
    await db.$client.end();
    await database.drop();
  }
}

describe.skipIf(!testServer)('R11 the minute cron closes a turn its host left open', () => {
  it('abandons a turn open past the hour once, releasing its reservation', closesACrashedTurn);

  it(
    'PA-17 starts the turn of a request recorded two minutes ago that never started',
    startsAnUnstartedTurn,
  );
});
