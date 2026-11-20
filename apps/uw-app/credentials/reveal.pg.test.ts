import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PushPayload } from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import { testServer } from '@uw/db/test-database';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { pushStore, type PushDevice } from '../notify/push/store.ts';
import type { PushTransport } from '../notify/push/transport.ts';
import { endpointFor, subscription } from '../notify/testing.ts';
import { pgWorld, type PgWorld } from '../testing/credentials-world.ts';
import { revealCredential } from './reveal.ts';
import { giveRevealGrant } from './reveal-grants.ts';
import { revokeCredential } from './revoke.ts';
import { tellAreaAdmins, type RevealNotice } from './tell-admins.ts';
import { logOf, now, people, person, traceId } from './testing/store-world.ts';

const coAdmin = '00000000-0000-4000-8000-0000000159d1';
const name = 'Funder portal login';
const value = 'uw-planted-credential-value-159-reveal';

type Sent = { readonly endpoint: string; readonly payload: PushPayload; readonly rank: number };

let world: PgWorld;
let credentialId = '';
const owners = new Map<string, string>();

async function device(personId: string, label: string): Promise<void> {
  const endpoint = endpointFor(label);
  owners.set(endpoint, personId);
  await pushStore(world.db).subscribe(personId, await subscription(endpoint), now);
}

function recording(status: number | 'failed' = 201) {
  const sent: Sent[] = [];
  const lines: string[] = [];
  const transport: PushTransport = {
    send: async (target: PushDevice, payload, rank) => {
      sent.push({ endpoint: target.endpoint, payload, rank });
      return status;
    },
  };
  const logger = createLogger(
    { traceId, commit: 'test', route: 'POST /api/credentials/reveal', principal: null },
    (line) => lines.push(line),
  );
  return { sent, lines, transport, logger };
}

function toldTo(sent: readonly Sent[]): string[] {
  return sent.map((entry) => owners.get(entry.endpoint) ?? 'nobody').sort();
}

function noticeBy(revealedBy: string): RevealNotice {
  return { credentialId, jdArea: '20-29', revealedBy, at: now };
}

function telling(): void {
  it('tells every admin of the credential’s area but the one who revealed, on every device', async () => {
    const run = recording();
    await tellAreaAdmins({ db: world.db, ...run })(noticeBy(people.admin));
    expect(toldTo(run.sent)).toEqual([coAdmin, coAdmin]);
    const byViewer = recording();
    await tellAreaAdmins({ db: world.db, ...byViewer })(noticeBy(people.viewer));
    expect(toldTo(byViewer.sent)).toEqual([coAdmin, coAdmin, people.admin].sort());
  });

  it('names the area and the reason, and never the credential', async () => {
    const run = recording();
    await tellAreaAdmins({ db: world.db, ...run })(noticeBy(people.viewer));
    expect(run.sent[0]).toMatchObject({
      payload: { harness: '20-29 Finance', reason: 'credential_revealed', link: '/credentials' },
      rank: 3,
    });
    const said = JSON.stringify(run.sent.map((entry) => entry.payload));
    expect(said).not.toContain(credentialId);
    expect(said).not.toContain(name);
    expect(said).not.toContain(value);
    expect(run.lines.join('\n')).not.toContain(value);
    expect(run.lines.at(-1)).toContain('"outcome":"reveal_told"');
    expect(run.lines.at(-1)).toContain('"admin_count":2');
  });

  it('does not throw when push is not configured, when a push fails or when the transport throws', async () => {
    const off = recording();
    await tellAreaAdmins({ db: world.db, transport: null, logger: off.logger })(
      noticeBy(people.viewer),
    );
    expect(off.lines.join('\n')).toContain('push_not_configured');
    const failing = recording('failed');
    await tellAreaAdmins({ db: world.db, ...failing })(noticeBy(people.viewer));
    expect(failing.lines.at(-1)).toContain('"sent_count":0');
    const thrown = recording();
    const transport: PushTransport = { send: () => Promise.reject(new Error(value)) };
    await tellAreaAdmins({ db: world.db, transport, logger: thrown.logger })(
      noticeBy(people.viewer),
    );
    expect(thrown.lines.join('\n')).not.toContain(value);
  });
}

function revealing(): void {
  it('returns the text to a person with a live reveal grant, after the log row, and tells once', async () => {
    const told: { notice: RevealNotice; logged: string | undefined }[] = [];
    const tell = async (notice: RevealNotice) => {
      const last = (await logOf(world.db, credentialId)).at(-1);
      told.push({ notice, logged: `${last?.action} ${last?.outcome}` });
    };
    const revealed = await revealCredential(
      { ...world.deps, tell },
      person('viewer'),
      credentialId,
      traceId,
    );
    expect(revealed).toEqual({ ok: true, value });
    expect(told).toEqual([
      {
        notice: { credentialId, jdArea: '20-29', revealedBy: people.viewer, at: now },
        logged: 'reveal done',
      },
    ]);
  });

  it('tells nobody and returns no value when the reveal is refused', async () => {
    const told: RevealNotice[] = [];
    const deps = { ...world.deps, tell: async (notice: RevealNotice) => void told.push(notice) };
    for (const actor of [person('editor'), person('admin'), person('orgAdmin')]) {
      expect(await revealCredential(deps, actor, credentialId, traceId)).toEqual({
        ok: false,
        reason: 'not_permitted',
      });
    }
    expect(await revealCredential(deps, person('outsider'), credentialId, traceId)).toEqual({
      ok: false,
      reason: 'credential_not_found',
    });
    world.keys.failNext('key_service_unavailable');
    expect(await revealCredential(deps, person('viewer'), credentialId, traceId)).toEqual({
      ok: false,
      reason: 'key_service_unavailable',
    });
    await revokeCredential(world.deps, person('admin'), credentialId, traceId);
    expect(await revealCredential(deps, person('viewer'), credentialId, traceId)).toEqual({
      ok: false,
      reason: 'credential_revoked',
    });
    expect(told).toEqual([]);
  });
}

describe.skipIf(!testServer)('#159 revealing a credential to a person', () => {
  beforeAll(async () => {
    world = await pgWorld(testServer ?? '');
    await seedPerson(world.db, { id: coAdmin, email: 'cred-co-admin@example.org' });
    await seedGrant(world.db, {
      id: '00000000-0000-4000-8000-0000000159d2',
      personId: coAdmin,
      role: 'admin',
      scopeKind: 'jd_area',
      scopeArea: '20-29',
      grantedAt: new Date('2026-11-01T09:00:00.000Z'),
      expiresAt: null,
    });
    await device(coAdmin, 'co-admin-phone');
    await device(coAdmin, 'co-admin-laptop');
    for (const who of ['admin', 'editor', 'viewer', 'orgAdmin', 'outsider'] as const) {
      await device(people[who], `${who}-phone`);
    }
    credentialId = await world.created(name, value);
    const grant = { credentialId, personId: people.viewer, minutes: 60 };
    await giveRevealGrant(world.deps, person('admin'), grant, traceId);
  });

  afterAll(async () => {
    await world.drop();
  });

  describe('telling the area’s admins', telling);
  describe('the reveal itself', revealing);
});
