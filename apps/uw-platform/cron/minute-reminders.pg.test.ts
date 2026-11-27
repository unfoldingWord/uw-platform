import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assistantIdentityOf, type HarnessEvent, type Principal } from '@uw/contracts';
import {
  assistantProvisionerPrincipal,
  ingestPrincipal,
  systemPrincipal,
} from '@uw/core/principal';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { projectSeededPersona, seedPage } from '@uw/db/test-seed';
import {
  assistantPersonaDraft,
  assistantRole,
  createKernel,
  DEFAULT_SPEND_CAP,
  type Caller,
  type DirectMessage,
  type DirectMessages,
  type Kernel,
  type LoopResult,
  type ModelEngine,
} from '@uw/harness';
import type { Bindings } from '../env.ts';
import { platformPorts } from '../kernel.ts';
import { directMessagesOf, type DirectMessagesFactory } from '../assistants/direct-messages.ts';
import { allEvents } from '../testing/commands.ts';
import { personOn } from '../testing/kernel.ts';
import type { CronDeps } from './job.ts';
import { minuteJob } from './minute.ts';
import { zulipAdmin } from '../assistants/zulip/admin.ts';
import { provisionZulipBot } from '../assistants/zulip/provision.ts';
import { FAKE_ADMIN, FAKE_ZULIP_SITE, fakeZulip } from '../assistants/zulip/testing/fake-zulip.ts';
import { credentialsDepsOf } from '../credentials/compose.ts';
import { fakeKms, fakeKmsAccess, fakeKmsRegion } from '../credentials/testing/fake-kms.ts';
import { systemTimers } from '../timers.ts';

type Line = Record<string, unknown>;
type Rig = {
  readonly db: Database;
  readonly env: Bindings;
  readonly harnessId: string;
  readonly lines: Line[];
};

const rowanId = '00000000-0000-4000-8000-000000000001';
const pageId = '00000000-0000-4000-8000-000000008701';
const DAY_MS = 24 * 60 * 60_000;
const start = new Date();
const reply: LoopResult = {
  outcome: 'ended',
  text: 'I will remind you.',
  usage: { inputTokens: 10, outputTokens: 2, costMicros: 10_000 },
  resolvedProvider: null,
  resolvedModel: assistantRole.model,
  toolsCalled: [],
  turns: 1,
};
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
    { assistantsArea: '90-99', assistantSpendCapMinor: null },
  );
}

async function assistantFor(db: Database, kernel: Kernel): Promise<string> {
  const rowan = await personOn(db, rowanId, 'rowan.test@unfoldingword.org', start);
  const { harness } = accepted(
    await kernel.assistants.provision(caller(rowan), {
      harnessId: randomUUID(),
      personId: rowanId,
    }),
  );
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
  return harness.id;
}

async function reminderSet(kernel: Kernel): Promise<void> {
  const { requestId } = accepted(
    await kernel.assistants.recordRequest(caller(ingestPrincipal()), {
      personId: rowanId,
      channel: 'zulip_dm',
      externalId: '901',
      threadKey: 'dm',
      replyAddress: 'zulip:5001',
      receivedAt: start.toISOString(),
      note: 'Remind me tomorrow',
      untrustedParts: [],
    }),
  );
  const begin = { requestId, attemptId: randomUUID() };
  const turn = accepted(await kernel.assistants.beginTurn(caller(systemPrincipal()), begin));
  const dueAt = new Date(start.getTime() + DAY_MS).toISOString();
  const address = { requestId, turnId: turn.turnId };
  accepted(
    await kernel.assistants.setReminder(caller(turn.principal), {
      ...address,
      text: 'Call Ana',
      dueAt,
    }),
  );
  accepted(
    await kernel.assistants.finishTurn(caller(systemPrincipal()), { ...address, result: reply }),
  );
}

function recording(sent: DirectMessage[]): DirectMessagesFactory {
  const port: DirectMessages = {
    send: async (message) => {
      sent.push(message);
      return { outcome: 'sent' };
    },
  };
  return () => port;
}

function depsOf(
  rig: Rig,
  directMessages: DirectMessagesFactory,
  fetcher: typeof fetch = () => Promise.reject(new Error('nothing but the spend read')),
): CronDeps {
  const spend = () =>
    Promise.resolve(
      Response.json({
        data: { viewer: { accounts: [{ aiGatewayRequestsAdaptiveGroups: [] }] } },
      }),
    );
  return {
    now: () => new Date(start.getTime() + 2 * DAY_MS),
    fetch: fetcher,
    sink: (line) => rig.lines.push(JSON.parse(line) as Line),
    newId: () => randomUUID(),
    commit: 'c',
    engines: {
      AI_GATEWAY_ACCOUNT_ID: 'account',
      AI_GATEWAY_ID: 'gateway',
      AI_GATEWAY_ANALYTICS_TOKEN: 'analytics',
      fetch: spend,
    },
    directMessages,
  };
}

async function withRig(work: (rig: Rig) => Promise<void>): Promise<void> {
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  try {
    const kernel = kernelOn(db);
    const harnessId = await assistantFor(db, kernel);
    await reminderSet(kernel);
    const env: Bindings = { HYPERDRIVE: { connectionString: database.connectionString } };
    await work({ db, env, harnessId, lines: [] });
  } finally {
    await db.$client.end();
    await database.drop();
  }
}

async function named(rig: Rig, name: string): Promise<readonly HarnessEvent[]> {
  return (await allEvents(rig.db, rig.harnessId)).filter((event) => event.name === name);
}

function reminderLines(rig: Rig): readonly Line[] {
  return rig.lines.filter(
    (line) => line['route'] === 'cron minute' && line['step'] === 'reminders',
  );
}

async function firesOnce(rig: Rig): Promise<void> {
  const sent: DirectMessage[] = [];
  await minuteJob(rig.env, depsOf(rig, recording(sent)));
  await minuteJob(rig.env, depsOf(rig, recording(sent)));
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ personId: rowanId, replyAddress: 'zulip:5001' });
  expect(sent[0]?.text).toContain('Call Ana');
  expect(await named(rig, 'assistant_reminder_fired')).toHaveLength(1);
  expect(reminderLines(rig)).toEqual([
    expect.objectContaining({ outcome: 'reminders_fired', fired: 1, undelivered: 0 }),
    expect.objectContaining({ outcome: 'reminders_fired', fired: 0, undelivered: 0 }),
  ]);
}

async function platformFactory(rig: Rig): Promise<void> {
  await minuteJob(rig.env, depsOf(rig, directMessagesOf));
  const [undelivered] = await named(rig, 'assistant_reminder_undelivered');
  expect(undelivered?.evidence['why']).toBe('not_wired');
  expect(reminderLines(rig).at(-1)).toMatchObject({ fired: 0, undelivered: 1 });
}

async function zulipWorld(rig: Rig) {
  const kms = await fakeKms();
  const zulip = fakeZulip();
  zulip.addUser('rowan.test@unfoldingword.org', 'Rowan', 5001);
  const urlOf = (input: Parameters<typeof fetch>[0]) =>
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const fetcher: typeof fetch = (input, init) =>
    urlOf(input).startsWith(FAKE_ZULIP_SITE) ? zulip.fetch(input, init) : kms.fetcher(input, init);
  const env: Bindings = {
    ...rig.env,
    ZULIP_SITE: FAKE_ZULIP_SITE,
    CREDENTIALS_KMS_REGION: fakeKmsRegion,
    CREDENTIALS_KMS_KEY_ID: kms.keyArn,
    CREDENTIALS_KMS_ACCESS_KEY_ID: fakeKmsAccess.accessKeyId,
    CREDENTIALS_KMS_SECRET_ACCESS_KEY: fakeKmsAccess.secretAccessKey,
  };
  const platform = {
    fetch: fetcher,
    timers: systemTimers,
    clock: { now: () => start },
    newId: randomUUID,
  };
  const provisioned = await provisionZulipBot(
    {
      db: rig.db,
      kernel: kernelOn(rig.db),
      keys: credentialsDepsOf(env, rig.db, platform).keys,
      admin: zulipAdmin({ site: FAKE_ZULIP_SITE, ...FAKE_ADMIN }, fetcher, systemTimers),
      webhookUrl: 'https://ingest.example.org/webhooks/zulip-assistant',
      clock: { now: () => start },
      caller: caller(assistantProvisionerPrincipal()),
    },
    {
      harnessId: rig.harnessId,
      personId: rowanId,
      personEmail: 'rowan.test@unfoldingword.org',
      name: 'barnabas',
    },
  );
  expect(provisioned).toEqual({ outcome: 'provisioned', botUserId: 1002, paired: true });
  return { zulip, env, fetcher };
}

async function deliveredByMyBot(rig: Rig): Promise<void> {
  const { zulip, env, fetcher } = await zulipWorld(rig);
  await minuteJob(env, depsOf(rig, directMessagesOf, fetcher));
  await minuteJob(env, depsOf(rig, directMessagesOf, fetcher));
  const sent = zulip.messages();
  expect(sent.map((message) => [message.sender, message.type, message.to])).toEqual([
    ['barnabas-bot@chat.example.org', 'direct', [5001]],
  ]);
  expect(sent[0]?.content).toContain('Call Ana');
  expect(await named(rig, 'assistant_reminder_fired')).toHaveLength(1);
  expect(await named(rig, 'assistant_reminder_undelivered')).toEqual([]);
}

describe('PA-5 the minute cron fires due reminders through the DirectMessages factory', () => {
  it('fires a due reminder once across two minutes, through the factory it was given', () =>
    withRig(firesOnce));

  it('records the closed-set reason when no Zulip site is configured', () =>
    withRig(platformFactory));

  it('PA-6 delivers the due reminder once as a direct message from my own Zulip bot', () =>
    withRig(deliveredByMyBot));
});
