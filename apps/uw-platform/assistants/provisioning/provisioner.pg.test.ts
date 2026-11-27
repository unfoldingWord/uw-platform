import { sql } from 'drizzle-orm';
import { exportPKCS8, generateKeyPair, type CryptoKey } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { assistantIdentityOf } from '@uw/contracts';
import { assistantProvisionerPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { createKernel, type Kernel } from '@uw/harness';
import { memoryDataKeys } from '../../credentials/testing/memory-data-keys.ts';
import { platformPorts } from '../../kernel.ts';
import { personOn } from '../../testing/kernel.ts';
import { testServer, withAppDatabase } from '../../testing/postgres.ts';
import type { Timers } from '../../timers.ts';
import { platformKernelSettings } from '../area.ts';
import { googleDirectory } from '../google/directory.ts';
import { mailboxOf } from '../google/subjects.ts';
import { fakeGoogle, type FakeGoogle } from '../google/testing/fake-google.ts';
import { zulipAdmin } from '../zulip/admin.ts';
import { botOfHarness } from '../zulip/bots.ts';
import {
  FAKE_ADMIN,
  FAKE_ZULIP_SITE,
  fakeZulip,
  type FakeZulip,
} from '../zulip/testing/fake-zulip.ts';
import { deleteTurnedOff } from './deletion.ts';
import { provisionDue } from './provisioner.ts';
import type { ProvisionerDeps } from './types.ts';

const ana = '00000000-0000-4000-8000-0000000e0601';
const ben = '00000000-0000-4000-8000-0000000e0602';
const domain = 'unfoldingword.org';
const adminSubject = 'platform-admin@unfoldingword.org';
const waits: Timers = { after: () => new Promise<void>(() => undefined) };
let privateKey = '';
let publicKey: CryptoKey;
let now = new Date('2026-11-27T09:00:00.000Z');
const clock = { now: () => now };

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = await exportPKCS8(pair.privateKey);
  publicKey = pair.publicKey;
});

type Rig = {
  readonly deps: ProvisionerDeps;
  readonly kernel: Kernel;
  readonly google: FakeGoogle;
  readonly zulip: FakeZulip;
};

async function rig(db: Database, wired = true): Promise<Rig> {
  now = new Date('2026-11-27T09:00:00.000Z');
  const handle = { db, ping: async () => undefined, release: async () => undefined };
  const kernel = createKernel({ ...platformPorts(handle), clock }, platformKernelSettings);
  const google = fakeGoogle();
  google.trust(publicKey);
  google.addUser(adminSubject);
  const zulip = fakeZulip();
  const tokens = {
    account: { clientEmail: 'assistants@uw-platform.iam.gserviceaccount.com', privateKey },
    fetcher: google.fetch,
    now: clock.now,
    lookup: async (email: string) => (email === adminSubject ? ('admin' as const) : null),
    cache: new Map(),
  };
  const caller = { actor: assistantProvisionerPrincipal(), traceId: crypto.randomUUID() };
  const zulipDeps = {
    db,
    kernel,
    keys: await memoryDataKeys(),
    admin: zulipAdmin({ site: FAKE_ZULIP_SITE, ...FAKE_ADMIN }, zulip.fetch, waits),
    webhookUrl: 'https://ingest.example.org/webhooks/zulip-assistant',
    clock,
    caller: { ...caller, requestId: null },
  };
  const workspace = {
    directory: googleDirectory({ tokens, adminSubject }),
    domain,
    unit: '/Assistants',
  };
  const deps: ProvisionerDeps = {
    db,
    kernel,
    clock,
    newId: () => crypto.randomUUID(),
    caller: { ...caller, requestId: null },
    workspace: wired ? workspace : null,
    zulip: wired ? zulipDeps : null,
  };
  return { deps, kernel, google, zulip };
}

async function person(db: Database, id: string, email: string) {
  await seedPerson(db, { id, email });
  await seedGrant(db, {
    id: crypto.randomUUID(),
    personId: id,
    role: 'viewer',
    scopeKind: 'jd_area',
    scopeArea: '30-39',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  return personOn(db, id, email, now);
}

function call(actor: Awaited<ReturnType<typeof person>>) {
  return { actor, traceId: crypto.randomUUID(), requestId: null };
}

async function eventsOf(db: Database, harnessId: string): Promise<unknown[]> {
  const rows = await db.execute<{ name: string; evidence: unknown }>(
    sql`SELECT name, evidence FROM harness_events WHERE harness_id = ${harnessId}
      AND name LIKE 'assistant_%' ORDER BY position`,
  );
  return rows.map((row) => [row.name, row.evidence]);
}

async function expectPairedWithActivePersona(
  db: Database,
  harnessId: string,
  anaZulip: number,
): Promise<void> {
  const bindings = await db.execute<{ channel: string; address: string }>(
    sql`SELECT channel, address FROM assistant_bindings WHERE harness_id = ${harnessId}
      ORDER BY channel`,
  );
  expect(bindings.map((row) => [row.channel, row.address])).toEqual([
    ['email', `ana@${domain}`],
    ['zulip_dm', `zulip:${String(anaZulip)}`],
  ]);
  const [persona] = await db.execute<{ status: string }>(
    sql`SELECT p.status FROM personas r JOIN pages p ON p.id = r.page_id
      WHERE r.identity = ${assistantIdentityOf(ana)}`,
  );
  expect(persona?.status).toBe('active');
}

async function turnedOnEndToEnd(db: Database): Promise<void> {
  const { deps, kernel, google, zulip } = await rig(db);
  const anaPerson = await person(db, ana, `ana@${domain}`);
  const anaZulip = zulip.addUser(`ana@${domain}`, 'Ana');
  const on = await kernel.assistants.enable(call(anaPerson), {
    harnessId: crypto.randomUUID(),
    name: 'barnabas',
  });
  if (on.status !== 'accepted') throw new Error(on.reason);
  const { harnessId } = on.value;
  expect(await provisionDue(deps, 5)).toEqual([{ harnessId, step: 'assist', outcome: 'waiting' }]);
  expect(google.directory.user(`barnabas@${domain}`)).toMatchObject({
    orgUnitPath: '/Assistants',
    suspended: false,
    externalIds: [{ customType: 'uw-assistant-harness', value: harnessId }],
  });
  expect(await mailboxOf(db, harnessId)).toMatchObject({
    address: `barnabas@${domain}`,
    status: 'active',
  });
  expect(await botOfHarness(db, harnessId)).toMatchObject({
    fullName: 'barnabas',
    status: 'active',
  });
  await expectPairedWithActivePersona(db, harnessId, anaZulip);
  expect(await provisionDue(deps, 5)).toEqual([]);
  const granted = await kernel.delegations.grant(call(anaPerson), {
    harnessId,
    persona: assistantIdentityOf(ana),
    capability: 'assist',
    maxTier: null,
    expiresAt: null,
    supersedes: null,
  });
  expect(granted.status).toBe('accepted');
  now = new Date(now.getTime() + 6 * 60_000);
  expect(await provisionDue(deps, 5)).toEqual([{ harnessId, step: 'assist', outcome: 'done' }]);
  expect(await provisionDue(deps, 5)).toEqual([]);
  expect(zulip.bots()).toHaveLength(1);
  expect(await eventsOf(db, harnessId)).toEqual([
    ['assistant_enabled', { jdId: '10.51', restored: false }],
    ['assistant_paired', { channel: 'email', via: 'email_match' }],
    ['assistant_paired', { channel: 'zulip_dm', via: 'email_match' }],
    ['assistant_provisioned', { goal: 'enabled' }],
  ]);
}

async function offOnAndDeleted(db: Database): Promise<void> {
  const { deps, kernel, google, zulip } = await rig(db);
  const anaPerson = await person(db, ana, `ana@${domain}`);
  const on = await kernel.assistants.enable(call(anaPerson), {
    harnessId: crypto.randomUUID(),
    name: 'barnabas',
  });
  if (on.status !== 'accepted') throw new Error(on.reason);
  const { harnessId } = on.value;
  await provisionDue(deps, 5);
  await kernel.assistants.disable(call(anaPerson), {});
  expect(await provisionDue(deps, 5)).toEqual([
    { harnessId, step: 'deactivate_bot', outcome: 'done' },
  ]);
  expect(google.directory.user(`barnabas@${domain}`)?.suspended).toBe(true);
  expect(zulip.bots()[0]?.is_active).toBe(false);
  await kernel.assistants.enable(call(anaPerson), { harnessId, name: 'barnabas' });
  await provisionDue(deps, 5);
  expect(google.directory.user(`barnabas@${domain}`)?.suspended).toBe(false);
  expect(zulip.bots()[0]?.is_active).toBe(true);
  await kernel.assistants.disable(call(anaPerson), {});
  await provisionDue(deps, 5);
  now = new Date(now.getTime() + 29 * 86_400_000);
  expect(await deleteTurnedOff(deps, 10)).toEqual({ deleted: [], failed: [] });
  now = new Date(now.getTime() + 86_400_000);
  expect(await deleteTurnedOff(deps, 10)).toEqual({ deleted: [harnessId], failed: [] });
  expect(google.directory.user(`barnabas@${domain}`)).toBeNull();
  expect(await mailboxOf(db, harnessId)).toBeNull();
  expect(zulip.bots()[0]?.is_active).toBe(false);
  const names = (await eventsOf(db, harnessId)).map((event) => (event as string[])[0]);
  expect(names.at(-1)).toBe('assistant_deleted');
}

async function aTakenNameFailsOnce(db: Database): Promise<void> {
  const { deps, kernel, google } = await rig(db);
  google.directory.add(`ops@${domain}`, [`silas@${domain}`]);
  const benPerson = await person(db, ben, `ben@${domain}`);
  const on = await kernel.assistants.enable(call(benPerson), {
    harnessId: crypto.randomUUID(),
    name: 'silas',
  });
  if (on.status !== 'accepted') throw new Error(on.reason);
  const { harnessId } = on.value;
  expect(await provisionDue(deps, 5)).toEqual([
    { harnessId, step: 'workspace_user', outcome: 'failed' },
  ]);
  expect(await provisionDue(deps, 5)).toEqual([]);
  now = new Date(now.getTime() + 3 * 60_000);
  expect(await provisionDue(deps, 5)).toEqual([
    { harnessId, step: 'workspace_user', outcome: 'failed' },
  ]);
  expect(await eventsOf(db, harnessId)).toEqual([
    ['assistant_enabled', { jdId: '10.51', restored: false }],
    ['assistant_provisioning_failed', { step: 'workspace_user', why: 'name_taken' }],
  ]);
}

async function notWiredIsAFailure(db: Database): Promise<void> {
  const { deps, kernel } = await rig(db, false);
  const anaPerson = await person(db, ana, `ana@${domain}`);
  const on = await kernel.assistants.enable(call(anaPerson), {
    harnessId: crypto.randomUUID(),
    name: 'barnabas',
  });
  if (on.status !== 'accepted') throw new Error(on.reason);
  expect(await provisionDue(deps, 5)).toEqual([
    { harnessId: on.value.harnessId, step: 'workspace_user', outcome: 'failed' },
  ]);
  expect(await eventsOf(db, on.value.harnessId)).toContainEqual([
    'assistant_provisioning_failed',
    { step: 'workspace_user', why: 'workspace_not_wired' },
  ]);
}

describe.skipIf(!testServer)('PA-14 the assistant provisioner', () => {
  it('makes the Workspace user, the bot, the pairing and the persona, then waits for my assist delegation', () =>
    withAppDatabase(turnedOnEndToEnd));

  it('suspends and deactivates on turning off, restores both on turning on, and deletes the user 30 days after', () =>
    withAppDatabase(offOnAndDeleted));

  it('fails a name Workspace already holds as an alias, records it once and backs off', () =>
    withAppDatabase(aTakenNameFailsOnce));

  it('names a missing Workspace configuration as a failure, never silence', () =>
    withAppDatabase(notWiredIsAFailure));
});
