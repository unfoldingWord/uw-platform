import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@uw/contracts';
import { parsePrincipal } from '@uw/core/principal';
import { testServer } from '@uw/db/test-database';
import { revokeSeededGrant, seedGrant, seedPerson } from '@uw/db/test-seed';
import { pgWorld, type PgWorld } from '../testing/credentials-world.ts';
import { bindCredential, unbindCredential } from './bindings.ts';
import { exposeSecret, type Secret } from './secret.ts';
import type { CredentialsDeps } from './store.ts';
import {
  duringUnwrap,
  harnessId,
  logOf,
  now,
  person,
  rewrite,
  runId,
  traceId,
} from './testing/store-world.ts';
import { useCredential, type CredentialUse } from './use.ts';

let world: PgWorld;

const later = new Date('2026-11-20T09:00:04.000Z');
const send = { harnessId, connectorKey: 'send' } as const;

async function bound(name: string): Promise<string> {
  const id = await world.created(name);
  await bindCredential(world.deps, person('admin'), { credentialId: id, ...send }, traceId);
  return id;
}

function delayed(change: () => Promise<void>): CredentialsDeps {
  let current = now;
  const changed = async () => {
    await change();
    current = later;
  };
  return {
    ...world.deps,
    keys: duringUnwrap(world.keys, changed),
    clock: { now: () => new Date(current) },
  };
}

type Runner = { readonly seed: Principal; readonly grantId: string };

async function runner(n: number): Promise<Runner> {
  const personId = `00000000-0000-4000-8000-0000001588a${n}`;
  const grantId = `00000000-0000-4000-8000-0000001588b${n}`;
  await seedPerson(world.db, { id: personId, email: `cred-runner-${n}@example.org` });
  await seedGrant(world.db, {
    id: grantId,
    personId,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: '20-29',
    grantedAt: new Date('2026-11-01T09:00:00.000Z'),
    expiresAt: null,
  });
  const seed = parsePrincipal({
    identity: `agent:${personId}/laptop`,
    kind: 'agent',
    personId,
    email: null,
    grants: [],
    interactive: false,
  });
  return { seed, grantId };
}

function outside() {
  const seen: string[] = [];
  const call = async (secret: Secret<string>) => {
    seen.push(exposeSecret(secret));
    return { outcome: 'succeeded' } as const;
  };
  return { seen, call };
}

function useOf(actor: Principal, credentialId: string): CredentialUse {
  return { actor, ref: { credentialId }, usedBy: send, runId, traceId };
}

async function expectNeverUsed(id: string, reason: string, seen: readonly string[]) {
  expect(seen).toEqual([]);
  const uses = (await logOf(world.db, id)).filter((entry) => entry.action === 'use');
  expect(uses.map((entry) => entry.outcome)).toEqual(['refused']);
  expect(uses.at(-1)).toMatchObject({ reason, harness_id: harnessId, connector_key: 'send' });
}

function withdrawn(): void {
  it("never calls out when the run's person lost the grant while the key service answered", async () => {
    const id = await bound('Run person left mid-use');
    const { seed, grantId } = await runner(1);
    const partner = outside();
    const deps = delayed(() => revokeSeededGrant(world.db, grantId, now));
    expect(await useCredential(deps, useOf(seed, id), partner.call)).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
    await expectNeverUsed(id, 'not_permitted', partner.seen);
  });

  it('never calls out when the credential was unbound while the key service answered', async () => {
    const id = await bound('Unbound mid-use');
    const { seed } = await runner(2);
    const partner = outside();
    const unbind = async () => {
      const binding = { credentialId: id, ...send };
      const outcome = await unbindCredential(world.deps, person('admin'), binding, traceId);
      expect(outcome).toEqual({ ok: true });
    };
    expect(await useCredential(delayed(unbind), useOf(seed, id), partner.call)).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
    await expectNeverUsed(id, 'not_permitted', partner.seen);
    const actions = (await logOf(world.db, id)).map((entry) => entry.action);
    expect(actions.slice(-2)).toEqual(['unbind', 'use']);
  });

  it('never calls out when the credential was revoked while the key service answered', async () => {
    const id = await bound('Revoked mid-use');
    const { seed } = await runner(3);
    const partner = outside();
    const deps = delayed(() => rewrite(world.db, id, { revokedAt: now }));
    expect(await useCredential(deps, useOf(seed, id), partner.call)).toEqual({
      ok: false,
      reason: 'credential_revoked',
    });
    await expectNeverUsed(id, 'credential_revoked', partner.seen);
  });
}

function unchanged(): void {
  it('still calls out when nothing changed while the key service answered', async () => {
    const id = await bound('Unchanged mid-use');
    const { seed } = await runner(4);
    const partner = outside();
    const used = await useCredential(
      delayed(() => Promise.resolve()),
      useOf(seed, id),
      partner.call,
    );
    expect(used).toEqual({ ok: true, value: { outcome: 'succeeded' } });
    expect(partner.seen).toEqual(['value of Unchanged mid-use']);
  });
}

function serialised(): void {
  it('makes an unbinding wait for whoever holds the credential row, as the final check does', async () => {
    const id = await bound('Unbinding behind the lock');
    let settled = false;
    let unbinding: Promise<unknown> = Promise.resolve();
    await world.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM credentials WHERE id = ${id} FOR UPDATE`);
      const binding = { credentialId: id, ...send };
      unbinding = unbindCredential(world.deps, person('admin'), binding, traceId).then(
        (outcome) => {
          settled = true;
          return outcome;
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
    });
    expect(await unbinding).toEqual({ ok: true });
  });
}

describe.skipIf(!testServer)('#158 a use is checked again after the key service answers', () => {
  beforeAll(async () => {
    world = await pgWorld(testServer ?? '');
  });

  afterAll(async () => {
    await world.drop();
  });

  describe('a use withdrawn during the unwrap never reaches the outside call', withdrawn);
  describe('a use nothing withdrew still reaches the outside call', unchanged);
  describe('an unbinding and the final check take the same lock', serialised);
});
