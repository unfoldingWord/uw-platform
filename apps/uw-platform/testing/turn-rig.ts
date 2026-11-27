import { randomUUID } from 'node:crypto';
import { assistantIdentityOf, ingestEnvelopeSchema, type Principal } from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import { assistantProvisionerPrincipal } from '@uw/core/principal';
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
import type { AssistantTurnStart, Bindings } from '../env.ts';
import { platformPorts } from '../kernel.ts';
import { credentialsDepsOf } from '../credentials/compose.ts';
import { fakeKms, fakeKmsAccess, fakeKmsRegion } from '../credentials/testing/fake-kms.ts';
import { fakeFetch, type FakeFetch } from './engine-fetch.ts';
import { personOn } from './kernel.ts';
import { systemTimers } from '../timers.ts';
import { zulipAdmin } from '../assistants/zulip/admin.ts';
import { assistantDmHandler } from '../assistants/zulip/inbound.ts';
import { botShortName, provisionZulipBot } from '../assistants/zulip/provision.ts';
import {
  FAKE_ADMIN,
  FAKE_ZULIP_SITE,
  fakeZulip,
  type FakeZulip,
} from '../assistants/zulip/testing/fake-zulip.ts';
import { turnStarterOf } from '../assistants/turn/start.ts';
import { exportPKCS8, generateKeyPair } from 'jose';
import { fakeGoogle, type FakeGoogle } from '../assistants/google/testing/fake-google.ts';

export type TurnRig = {
  readonly db: Database;
  readonly kernel: Kernel;
  readonly env: Bindings;
  readonly harnessId: string;
  readonly zulip: FakeZulip;
  readonly google: FakeGoogle;
  readonly gateway: FakeFetch;
  readonly fetcher: typeof fetch;
  readonly started: AssistantTurnStart[];
  readonly start: Date;
  direct(content: string, messageId: number): Promise<readonly unknown[]>;
};

const rowanId = '00000000-0000-4000-8000-000000000001';
const pageId = '00000000-0000-4000-8000-000000008901';
const GATEWAY = 'https://gateway.ai.cloudflare.com/';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/';
const GOOGLE_APIS = 'https://www.googleapis.com/';
const GMAIL_API = 'https://gmail.googleapis.com/';

function caller(actor: Principal): Caller {
  return { actor, traceId: randomUUID(), requestId: null };
}

function accepted<T>(outcome: { status: string; value?: T; reason?: string }): T {
  if (outcome.status !== 'accepted' || outcome.value === undefined) {
    throw new Error(`refused: ${String(outcome.reason)}`);
  }
  return outcome.value;
}

function quietEngine(start: Date): ModelEngine {
  return {
    turn: () => Promise.reject(new Error('no model turn runs in the setup')),
    spend: async (since) => ({ spentMinor: 0, currency: 'USD', since, asOf: start }),
  };
}

function setupKernel(db: Database, start: Date): Kernel {
  const handle = { db, ping: async () => undefined, release: async () => undefined };
  return createKernel(
    { ...platformPorts(handle), clock: { now: () => start }, modelEngine: quietEngine(start) },
    { assistantsArea: '90-99', assistantSpendCapMinor: null, appOrigin: null },
  );
}

async function assistantFor(
  db: Database,
  kernel: Kernel,
  start: Date,
  system: Principal,
): Promise<string> {
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
  const grant = {
    harnessId: harness.id,
    persona: assistantIdentityOf(rowanId),
    capability: 'assist' as const,
    maxTier: null,
    expiresAt: null,
    supersedes: null,
  };
  accepted(await kernel.delegations.grant(caller(rowan), grant));
  const reading = { ...DEFAULT_SPEND_CAP, since: start };
  accepted(await kernel.breaker.check(caller(system), reading));
  return harness.id;
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

async function googleFor(email: string) {
  const google = fakeGoogle();
  const pair = await generateKeyPair('RS256', { extractable: true });
  google.trust(pair.publicKey);
  google.addUser(email);
  const key = JSON.stringify({
    type: 'service_account',
    client_email: 'assistants@uw-platform.iam.gserviceaccount.com',
    private_key: await exportPKCS8(pair.privateKey),
  });
  return { google, key };
}

async function world(connectionString: string) {
  const kms = await fakeKms();
  const { google, key } = await googleFor('rowan.test@unfoldingword.org');
  const zulip = fakeZulip();
  zulip.addUser('rowan.test@unfoldingword.org', 'Rowan', 5001);
  const gateway = fakeFetch();
  const fetcher: typeof fetch = (input, init) => {
    const url = urlOf(input);
    if (url.startsWith(FAKE_ZULIP_SITE)) return zulip.fetch(input, init);
    if (url.startsWith(GATEWAY)) return gateway.fetch(input, init);
    if ([GOOGLE_TOKEN, GOOGLE_APIS, GMAIL_API].some((prefix) => url.startsWith(prefix)))
      return google.fetch(input, init);
    return kms.fetcher(input, init);
  };
  const env: Bindings = {
    HYPERDRIVE: { connectionString },
    ZULIP_SITE: FAKE_ZULIP_SITE,
    CREDENTIALS_KMS_REGION: fakeKmsRegion,
    CREDENTIALS_KMS_KEY_ID: kms.keyArn,
    CREDENTIALS_KMS_ACCESS_KEY_ID: fakeKmsAccess.accessKeyId,
    CREDENTIALS_KMS_SECRET_ACCESS_KEY: fakeKmsAccess.secretAccessKey,
    OPENROUTER_API_KEY: 'openrouter-key',
    AI_GATEWAY_ACCOUNT_ID: 'account',
    AI_GATEWAY_ID: 'gateway',
    GOOGLE_WORKSPACE_KEY: key,
    GOOGLE_WORKSPACE_DOMAIN: 'unfoldingword.org',
  };
  return { zulip, google, gateway, fetcher, env };
}

async function botFor(rig: Omit<TurnRig, 'direct'>, kernel: Kernel): Promise<void> {
  const platform = {
    fetch: rig.fetcher,
    timers: systemTimers,
    clock: { now: () => rig.start },
    newId: randomUUID,
  };
  const provisioned = await provisionZulipBot(
    {
      db: rig.db,
      kernel,
      keys: credentialsDepsOf(rig.env, rig.db, platform).keys,
      admin: zulipAdmin({ site: FAKE_ZULIP_SITE, ...FAKE_ADMIN }, rig.fetcher, systemTimers),
      webhookUrl: 'https://ingest.example.org/webhooks/zulip-assistant',
      clock: { now: () => rig.start },
      caller: caller(assistantProvisionerPrincipal()),
    },
    {
      harnessId: rig.harnessId,
      personId: rowanId,
      personEmail: 'rowan.test@unfoldingword.org',
      name: 'barnabas',
    },
  );
  if (provisioned.outcome !== 'provisioned') throw new Error('the bot was not provisioned');
}

export function rigBotEmail(harnessId: string): string {
  return `${botShortName('barnabas', harnessId)}-bot@chat.example.org`;
}

function envelopeOf(content: string, messageId: number, ingest: Principal, botEmail: string) {
  const rowan = { id: 5001, email: 'rowan.test@unfoldingword.org', full_name: 'Rowan' };
  const bot = { id: 1002, email: botEmail, full_name: 'barnabas' };
  return ingestEnvelopeSchema.parse({
    envelopeVersion: 1,
    traceId: randomUUID(),
    source: 'zulip-assistant',
    deliveryId: `zulip-assistant:1002:${String(messageId)}`,
    event: 'message',
    receivedAt: new Date().toISOString(),
    principal: ingest,
    payload: {
      trigger: 'direct_message',
      bot_email: bot.email,
      message: {
        id: messageId,
        sender_id: rowan.id,
        sender_email: rowan.email,
        type: 'private',
        display_recipient: [rowan, bot],
        subject: '',
        content,
        timestamp: Math.floor(Date.now() / 1000),
      },
    },
    payloadTruncated: false,
  });
}

function directOf(
  rig: Omit<TurnRig, 'direct'>,
  kernel: Kernel,
  ingest: Principal,
): TurnRig['direct'] {
  const startTurn = turnStarterOf({
    create: async ({ id, params }) => {
      if (rig.started.some((start) => start.requestId === id)) {
        throw new Error(`instance.already_exists ${id}`);
      }
      rig.started.push(params);
      return {};
    },
  });
  const handler = assistantDmHandler({ db: rig.db, kernel, now: () => new Date(), startTurn });
  return async (content, messageId) => {
    const outcomes: unknown[] = [];
    const logger = createLogger(
      { traceId: randomUUID(), commit: 'test', route: 'queue ingest', principal: null },
      (line) => outcomes.push((JSON.parse(line) as Record<string, unknown>)['outcome']),
    );
    await handler(envelopeOf(content, messageId, ingest, rigBotEmail(rig.harnessId)), logger);
    return outcomes;
  };
}

export type RigPrincipals = { readonly system: Principal; readonly ingest: Principal };

export async function withTurnRig(
  principals: RigPrincipals,
  work: (rig: TurnRig) => Promise<void>,
): Promise<void> {
  const { system, ingest } = principals;
  const database = await createMigratedDatabase(testServer ?? '');
  const db = createClient(database.connectionString);
  try {
    const start = new Date();
    const kernel = setupKernel(db, start);
    const harnessId = await assistantFor(db, kernel, start, system);
    const parts = await world(database.connectionString);
    const base = { db, kernel, harnessId, started: [], start, ...parts };
    await botFor(base, kernel);
    await work({ ...base, direct: directOf(base, kernel, ingest) });
  } finally {
    await db.$client.end();
    await database.drop();
  }
}
