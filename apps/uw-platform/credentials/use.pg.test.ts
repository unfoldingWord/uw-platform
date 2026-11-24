import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@uw/contracts';
import { ingestPrincipal, parsePrincipal, systemPrincipal } from '@uw/core/principal';
import { testServer } from '@uw/db/test-database';
import { revokeSeededGrant, seedGrant, seedPerson } from '@uw/db/test-seed';
import { bindCredential } from './bindings.ts';
import { notConfiguredDataKeys } from './kms/not-configured.ts';
import { exposeSecret, type Secret } from './secret.ts';
import { createCredential } from './store.ts';
import { pgWorld, type PgWorld } from '../testing/credentials-world.ts';
import {
  agentOf,
  counts,
  grantIdOf,
  harnessId,
  logOf,
  now,
  otherHarnessId,
  people,
  person,
  rewrite,
  runId,
  traceId,
} from './testing/store-world.ts';
import { useCredential, type CredentialUse } from './use.ts';

let world: PgWorld;

const planted = 'uw-planted-credential-value-158-use';
const send = { harnessId, connectorKey: 'send' } as const;
const pending = { id: '00000000-0000-4000-8000-0000000158b1', email: 'cred-pending@example.org' };
const lapsed = { id: '00000000-0000-4000-8000-0000000158b2', email: 'cred-lapsed@example.org' };

type Sent = { readonly url: string; readonly authorization: string | null };

function partner() {
  const sent: Sent[] = [];
  const secrets: Secret<string>[] = [];
  const call = async (secret: Secret<string>) => {
    secrets.push(secret);
    const request = new Request('https://partner.example/send', {
      method: 'POST',
      headers: { authorization: `Bearer ${exposeSecret(secret)}` },
    });
    sent.push({ url: request.url, authorization: request.headers.get('authorization') });
    return { outcome: 'succeeded', detail: { status: '202' } } as const;
  };
  return { sent, secrets, call };
}

async function bound(name: string): Promise<string> {
  const id = await world.created(name, planted);
  await bindCredential(world.deps, person('admin'), { credentialId: id, ...send }, traceId);
  return id;
}

function useOf(actor: Principal, credentialId: string, usedBy = send): CredentialUse {
  return { actor, ref: { credentialId }, usedBy, runId, traceId };
}

function agentFor(personId: string): Principal {
  const identity = `agent:${personId}/laptop`;
  return parsePrincipal({ ...agentOf('editor'), identity, personId });
}

function seedOf(who: 'editor' | 'viewer' | 'admin'): Principal {
  return { ...agentOf(who), grants: [] };
}

async function lastLog(credentialId: string) {
  return (await logOf(world.db, credentialId)).at(-1);
}

function using(): void {
  it('opens the value for the call, hands back the outcome and records the use', async () => {
    const id = await bound('Used by an agent');
    const outside = partner();
    const used = await useCredential(world.deps, useOf(agentOf('editor'), id), outside.call);
    expect(used).toEqual({ ok: true, value: { outcome: 'succeeded', detail: { status: '202' } } });
    expect(outside.sent).toEqual([
      { url: 'https://partner.example/send', authorization: `Bearer ${planted}` },
    ]);
    expect(await lastLog(id)).toMatchObject({
      action: 'use',
      outcome: 'done',
      reason: null,
      actor: `agent:${people.editor}/laptop`,
      person_id: people.editor,
      harness_id: harnessId,
      connector_key: 'send',
      run_id: runId,
      trace_id: traceId,
    });
  });

  it('spends the secret when the call returns, so a kept reference exposes nothing', async () => {
    const id = await bound('Spent after the call');
    const outside = partner();
    await useCredential(world.deps, useOf(agentOf('editor'), id), outside.call);
    const [kept] = outside.secrets;
    expect(kept).toBeDefined();
    expect(() => (kept === undefined ? '' : exposeSecret(kept))).toThrow('secret_spent');
  });

  it("asks about the run's person: a seed principal with no grants uses on its person's grants", async () => {
    const id = await bound('Used by a run seed');
    const outside = partner();
    const used = await useCredential(world.deps, useOf(seedOf('editor'), id), outside.call);
    expect(used.ok).toBe(true);
    expect(await lastLog(id)).toMatchObject({
      actor: `agent:${people.editor}/laptop`,
      person_id: people.editor,
    });
  });

  it('lets a person at the keyboard who is an editor on the area use it', async () => {
    const id = await bound('Used by a person');
    const used = await useCredential(world.deps, useOf(person('editor'), id), partner().call);
    expect(used.ok).toBe(true);
  });
}

function refusing(): void {
  it.each([
    ['a viewer on the area', () => agentOf('viewer')],
    ['an admin of another area', () => agentOf('outsider')],
    ['an org admin with no grant on the area', () => person('orgAdmin')],
    ['the system, which is nobody', () => systemPrincipal()],
    ['the ingest identity, which is nobody', () => ingestPrincipal()],
  ])('refuses %s, never calls out and records the refusal', async (_name, actor) => {
    const id = await bound(`Not used by ${_name}`);
    const outside = partner();
    const used = await useCredential(world.deps, useOf(actor(), id), outside.call);
    expect(used).toEqual({ ok: false, reason: 'not_permitted' });
    expect(outside.sent).toEqual([]);
    expect(await lastLog(id)).toMatchObject({
      action: 'use',
      outcome: 'refused',
      reason: 'not_permitted',
      actor: actor().identity,
    });
  });

  it('never trusts the grants a principal carries: a person with no grant in the database is refused', async () => {
    const id = await bound('Carried grants are not enough');
    await seedPerson(world.db, lapsed);
    const outside = partner();
    const used = await useCredential(world.deps, useOf(agentFor(lapsed.id), id), outside.call);
    expect(used).toEqual({ ok: false, reason: 'not_permitted' });
    expect(outside.sent).toEqual([]);
  });
}

function refusingByPerson(): void {
  it('refuses a person who is not active, whatever grants they still hold', async () => {
    const id = await bound('Not used by a pending person');
    await seedPerson(world.db, { ...pending, status: 'pending' });
    await seedGrant(world.db, {
      id: '00000000-0000-4000-8000-0000000158b3',
      personId: pending.id,
      role: 'editor',
      scopeKind: 'jd_area',
      scopeArea: '20-29',
      grantedAt: now,
      expiresAt: null,
    });
    const used = await useCredential(world.deps, useOf(agentFor(pending.id), id), partner().call);
    expect(used).toEqual({ ok: false, reason: 'not_permitted' });
  });
}

function refusingByFacts(): void {
  it.each([
    ['another workflow', { harnessId: otherHarnessId, connectorKey: 'send' }],
    ['another connector', { harnessId, connectorKey: 'post' }],
  ])('refuses a use from %s than the one it is bound to', async (_name, usedBy) => {
    const id = await bound(`Not used from ${_name}`);
    const outside = partner();
    const used = await useCredential(
      world.deps,
      { ...useOf(agentOf('editor'), id), usedBy },
      outside.call,
    );
    expect(used).toEqual({ ok: false, reason: 'not_permitted' });
    expect(outside.sent).toEqual([]);
  });

  it.each([
    ['revoked', { revokedAt: now }, 'credential_revoked'],
    ['expired', { expiresAt: new Date('2026-11-20T08:00:00.000Z') }, 'credential_expired'],
  ])('refuses a %s credential and never calls out', async (_name, change, reason) => {
    const id = await bound(`A ${_name} credential`);
    await rewrite(world.db, id, change);
    const outside = partner();
    const used = await useCredential(world.deps, useOf(agentOf('editor'), id), outside.call);
    expect(used).toEqual({ ok: false, reason });
    expect(outside.sent).toEqual([]);
  });

  it.each([
    ['a reference that is not an id', 'not-a-credential'],
    ['a reference to nothing', '00000000-0000-4000-8000-0000000158f9'],
  ])('answers credential_not_found for %s', async (_name, credentialId) => {
    const outside = partner();
    const used = await useCredential(
      world.deps,
      useOf(agentOf('editor'), credentialId),
      outside.call,
    );
    expect(used).toEqual({ ok: false, reason: 'credential_not_found' });
    expect(outside.sent).toEqual([]);
  });
}

function unconfigured(): void {
  it('answers key_service_not_configured, recorded, when the key service has no settings', async () => {
    const id = await bound('No key service');
    const deps = { ...world.deps, keys: notConfiguredDataKeys };
    const outside = partner();
    const used = await useCredential(deps, useOf(agentOf('editor'), id), outside.call);
    expect(used).toEqual({ ok: false, reason: 'key_service_not_configured' });
    expect(outside.sent).toEqual([]);
    expect(await lastLog(id)).toMatchObject({
      action: 'use',
      outcome: 'refused',
      reason: 'key_service_not_configured',
    });
  });

  it('refuses to create a credential it could not seal, and writes nothing', async () => {
    const deps = { ...world.deps, keys: notConfiguredDataKeys };
    const before = await counts(world.db);
    const input = world.input('Created with no key service', planted);
    expect(await createCredential(deps, person('admin'), input, traceId)).toEqual({
      ok: false,
      reason: 'key_service_not_configured',
    });
    expect(await counts(world.db)).toEqual(before);
  });
}

function containing(): void {
  it('answers connector_failed, with no text, when the call throws the value', async () => {
    const id = await bound('A call that throws');
    const secrets: Secret<string>[] = [];
    const used = await useCredential(world.deps, useOf(agentOf('editor'), id), async (secret) => {
      secrets.push(secret);
      throw new Error(`partner refused Bearer ${exposeSecret(secret)}`);
    });
    expect(used).toEqual({ ok: false, reason: 'connector_failed' });
    expect(JSON.stringify(used)).not.toContain(planted);
    const [kept] = secrets;
    expect(() => (kept === undefined ? '' : exposeSecret(kept))).toThrow('secret_spent');
  });

  it.each([
    ['as a detail', (value: string) => ({ outcome: 'succeeded', detail: { echoed: value } })],
    ['inside a longer text', (value: string) => ({ outcome: 'refused', reason: `bad ${value}!` })],
    ['as a key', (value: string) => ({ [value]: 1 })],
    ['in a list', (value: string) => ({ seen: [[value]] })],
    ['as the whole outcome', (value: string) => value],
    ['in base64', (value: string) => ({ basic: btoa(value) })],
  ])('answers value_in_outcome when the call hands the value back %s', async (_name, leak) => {
    const id = await bound(`A call that leaks ${_name}`);
    const used = await useCredential(world.deps, useOf(agentOf('editor'), id), async (secret) =>
      leak(exposeSecret(secret)),
    );
    expect(used).toEqual({ ok: false, reason: 'value_in_outcome' });
  });

  it('answers value_in_outcome for an outcome it cannot walk to the end', async () => {
    const id = await bound('A call that answers a loop');
    const loop: Record<string, unknown> = {};
    loop['self'] = loop;
    const used = await useCredential(world.deps, useOf(agentOf('editor'), id), async () => loop);
    expect(used).toEqual({ ok: false, reason: 'value_in_outcome' });
  });

  it('refuses the use once the grant behind it is revoked, on the next call', async () => {
    const id = await bound('Used until the grant is revoked');
    expect((await useCredential(world.deps, useOf(agentOf('viewer'), id), partner().call)).ok).toBe(
      false,
    );
    expect((await useCredential(world.deps, useOf(agentOf('editor'), id), partner().call)).ok).toBe(
      true,
    );
    await revokeSeededGrant(world.db, grantIdOf('editor'), new Date('2026-11-20T08:59:00.000Z'));
    const used = await useCredential(world.deps, useOf(agentOf('editor'), id), partner().call);
    expect(used).toEqual({ ok: false, reason: 'not_permitted' });
  });
}

describe.skipIf(!testServer)('#158 a connector uses a credential by reference, on Postgres', () => {
  beforeAll(async () => {
    world = await pgWorld(testServer ?? '');
  });

  afterAll(async () => {
    await world.drop();
  });

  describe('a use where it is bound, by the person the run works for', using);
  describe('a use that is refused never calls out', refusing);
  describe('a person who may not act is refused', refusingByPerson);
  describe('a use the facts refuse never calls out', refusingByFacts);
  describe('a key service with no settings refuses', unconfigured);
  describe('the value never comes back from the call', containing);
});
