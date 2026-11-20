import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testServer } from '@uw/db/test-database';
import { bindCredential, unbindCredential } from './bindings.ts';
import { openCredential } from './open.ts';
import { pgWorld, type PgWorld } from '../testing/credentials-world.ts';
import {
  agentOf,
  harnessId,
  logOf,
  now,
  orgEditor,
  otherHarnessId,
  people,
  person,
  rewrite,
  runId,
  traceId,
} from './testing/store-world.ts';

let world: PgWorld;

const send = { harnessId, connectorKey: 'send' } as const;
const missingHarness = '00000000-0000-4000-8000-0000000158f1';
const missingCredential = '00000000-0000-4000-8000-0000000158f2';

async function bindingsOf(credentialId: string): Promise<string[]> {
  const rows = await world.db.execute<{ at: string }>(
    sql`SELECT harness_id || ':' || connector_key AS at FROM credential_bindings
        WHERE credential_id = ${credentialId} ORDER BY 1`,
  );
  return [...rows].map((row) => row.at);
}

function last<T>(rows: readonly T[]): T | undefined {
  return rows.at(-1);
}

function binding(): void {
  it('lets an area admin bind a credential to a workflow and connector, and records it', async () => {
    const id = await world.created('Bound by an admin');
    const outcome = await bindCredential(
      world.deps,
      person('admin'),
      { credentialId: id, ...send },
      traceId,
    );
    expect(outcome).toEqual({ ok: true });
    expect(await bindingsOf(id)).toEqual([`${harnessId}:send`]);
    expect(last(await logOf(world.db, id))).toEqual({
      action: 'bind',
      outcome: 'done',
      reason: null,
      actor: `human:${people.admin}`,
      person_id: people.admin,
      version_id: null,
      harness_id: harnessId,
      connector_key: 'send',
      run_id: null,
      trace_id: traceId,
    });
  });

  it('lets an org admin bind, who may manage and never use', async () => {
    const id = await world.created('Bound by an org admin');
    const change = { credentialId: id, ...send };
    expect(await bindCredential(world.deps, person('orgAdmin'), change, traceId)).toEqual({
      ok: true,
    });
    const use = { action: 'use', credentialId: id, usedBy: send, runId } as const;
    expect(await openCredential(world.deps, person('orgAdmin'), use, traceId)).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
  });
}

function bindingWhere(): void {
  it('makes a use possible only from the workflow and connector it names', async () => {
    const id = await world.created('Used where bound');
    const use = (usedBy: { harnessId: string; connectorKey: string }) =>
      openCredential(
        world.deps,
        person('editor'),
        { action: 'use', credentialId: id, usedBy, runId },
        traceId,
      );
    expect((await use(send)).ok).toBe(false);
    await bindCredential(world.deps, person('admin'), { credentialId: id, ...send }, traceId);
    expect((await use(send)).ok).toBe(true);
    expect((await use({ harnessId: otherHarnessId, connectorKey: 'send' })).ok).toBe(false);
    expect((await use({ harnessId, connectorKey: 'post' })).ok).toBe(false);
  });

  it('answers already_bound for a second identical binding and writes nothing', async () => {
    const id = await world.created('Bound twice');
    const change = { credentialId: id, ...send };
    await bindCredential(world.deps, person('admin'), change, traceId);
    const before = await logOf(world.db, id);
    expect(await bindCredential(world.deps, person('admin'), change, traceId)).toEqual({
      ok: false,
      reason: 'already_bound',
    });
    expect(await logOf(world.db, id)).toEqual(before);
    expect(await bindingsOf(id)).toHaveLength(1);
  });
}

function refusingBinding(): void {
  it.each([
    ['an editor on the area', () => person('editor'), 'not_permitted'],
    ['a viewer on the area', () => person('viewer'), 'not_permitted'],
    ['an admin of another area', () => person('outsider'), 'credential_not_found'],
    ['an org editor', () => orgEditor(), 'credential_not_found'],
    ['an agent of the area admin', () => agentOf('admin'), 'credential_not_found'],
  ])('refuses %s, records the refusal and binds nothing', async (_name, actor, answer) => {
    const id = await world.created(`Not bound by ${_name}`);
    const outcome = await bindCredential(
      world.deps,
      actor(),
      { credentialId: id, ...send },
      traceId,
    );
    expect(outcome).toEqual({ ok: false, reason: answer });
    expect(await bindingsOf(id)).toEqual([]);
    expect(last(await logOf(world.db, id))).toMatchObject({
      action: 'bind',
      outcome: 'refused',
      reason: 'not_permitted',
      actor: actor().identity,
      harness_id: harnessId,
      connector_key: 'send',
    });
  });
}

function refusingBindingByFacts(): void {
  it('refuses to bind a revoked credential and records it', async () => {
    const id = await world.created('Revoked before binding');
    await rewrite(world.db, id, { revokedAt: now });
    const change = { credentialId: id, ...send };
    expect(await bindCredential(world.deps, person('admin'), change, traceId)).toEqual({
      ok: false,
      reason: 'credential_revoked',
    });
    expect(await bindingsOf(id)).toEqual([]);
    expect(last(await logOf(world.db, id))).toMatchObject({
      action: 'bind',
      outcome: 'refused',
      reason: 'credential_revoked',
    });
  });

  it.each([
    ['a connector that is not an effect connector', { ...send, connectorKey: 'none' }],
    ['a connector nobody registered', { ...send, connectorKey: 'exfiltrate' }],
  ])('answers connector_unknown for %s', async (_name, at) => {
    const id = await world.created(`Unknown connector ${at.connectorKey}`);
    const change = { credentialId: id, ...at };
    expect(await bindCredential(world.deps, person('admin'), change, traceId)).toEqual({
      ok: false,
      reason: 'connector_unknown',
    });
    expect(await bindingsOf(id)).toEqual([]);
  });
}

function missing(): void {
  it('answers workflow_not_found for a workflow that does not exist', async () => {
    const id = await world.created('Bound to nothing');
    const change = { credentialId: id, harnessId: missingHarness, connectorKey: 'send' };
    expect(await bindCredential(world.deps, person('admin'), change, traceId)).toEqual({
      ok: false,
      reason: 'workflow_not_found',
    });
    expect(await bindingsOf(id)).toEqual([]);
    expect(last(await logOf(world.db, id))).toMatchObject({ action: 'create' });
  });

  it.each([
    ['a credential id that is not an id', { credentialId: 'not-an-id' }, 'credential_not_found'],
    ['a workflow id that is not an id', { harnessId: "x' OR 1=1" }, 'workflow_not_found'],
  ])('answers %s by its closed-set reason, on bind and unbind', async (_name, wrong, reason) => {
    const id = await world.created(`Malformed ${reason} ${Object.keys(wrong).join()}`);
    const change = { credentialId: id, ...send, ...wrong };
    const refusal = { ok: false, reason };
    expect(await bindCredential(world.deps, person('admin'), change, traceId)).toEqual(refusal);
    expect(await unbindCredential(world.deps, person('admin'), change, traceId)).toEqual(refusal);
  });

  it('answers credential_not_found for a credential that does not exist', async () => {
    const change = { credentialId: missingCredential, ...send };
    expect(await bindCredential(world.deps, person('admin'), change, traceId)).toEqual({
      ok: false,
      reason: 'credential_not_found',
    });
    expect(await unbindCredential(world.deps, person('admin'), change, traceId)).toEqual({
      ok: false,
      reason: 'credential_not_found',
    });
  });
}

function unbinding(): void {
  it('lets an area admin unbind, which ends the use and is recorded', async () => {
    const id = await world.created('Unbound by an admin');
    const change = { credentialId: id, ...send };
    await bindCredential(world.deps, person('admin'), change, traceId);
    expect(await unbindCredential(world.deps, person('admin'), change, traceId)).toEqual({
      ok: true,
    });
    expect(await bindingsOf(id)).toEqual([]);
    expect(last(await logOf(world.db, id))).toMatchObject({
      action: 'unbind',
      outcome: 'done',
      reason: null,
      actor: `human:${people.admin}`,
      harness_id: harnessId,
      connector_key: 'send',
    });
    const use = { action: 'use', credentialId: id, usedBy: send, runId } as const;
    expect(await openCredential(world.deps, person('editor'), use, traceId)).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
  });

  it('unbinds a revoked credential, so a binding never outlives its use', async () => {
    const id = await world.created('Unbound after revocation');
    const change = { credentialId: id, ...send };
    await bindCredential(world.deps, person('admin'), change, traceId);
    await rewrite(world.db, id, { revokedAt: now });
    expect(await unbindCredential(world.deps, person('admin'), change, traceId)).toEqual({
      ok: true,
    });
    expect(await bindingsOf(id)).toEqual([]);
  });
}

function unbindingOne(): void {
  it('leaves the other bindings of the credential in place', async () => {
    const id = await world.created('Bound in two places');
    const elsewhere = { credentialId: id, harnessId: otherHarnessId, connectorKey: 'post' };
    await bindCredential(world.deps, person('admin'), { credentialId: id, ...send }, traceId);
    await bindCredential(world.deps, person('admin'), elsewhere, traceId);
    await unbindCredential(world.deps, person('admin'), { credentialId: id, ...send }, traceId);
    expect(await bindingsOf(id)).toEqual([`${otherHarnessId}:post`]);
  });

  it('answers not_bound when there is no such binding and writes nothing', async () => {
    const id = await world.created('Never bound');
    const before = await logOf(world.db, id);
    const change = { credentialId: id, ...send };
    expect(await unbindCredential(world.deps, person('admin'), change, traceId)).toEqual({
      ok: false,
      reason: 'not_bound',
    });
    expect(await logOf(world.db, id)).toEqual(before);
  });

  it.each([
    ['an editor on the area', () => person('editor'), 'not_permitted'],
    ['an agent of the area admin', () => agentOf('admin'), 'credential_not_found'],
    ['an admin of another area', () => person('outsider'), 'credential_not_found'],
  ])('refuses %s, records the refusal and keeps the binding', async (_name, actor, answer) => {
    const id = await world.created(`Kept bound from ${_name}`);
    const change = { credentialId: id, ...send };
    await bindCredential(world.deps, person('admin'), change, traceId);
    expect(await unbindCredential(world.deps, actor(), change, traceId)).toEqual({
      ok: false,
      reason: answer,
    });
    expect(await bindingsOf(id)).toHaveLength(1);
    expect(last(await logOf(world.db, id))).toMatchObject({
      action: 'unbind',
      outcome: 'refused',
      reason: 'not_permitted',
      actor: actor().identity,
    });
  });
}

describe.skipIf(!testServer)('#158 binding a credential on Postgres', () => {
  beforeAll(async () => {
    world = await pgWorld(testServer ?? '');
  });

  afterAll(async () => {
    await world.drop();
  });

  describe('binding needs manage', binding);
  describe('a binding names one workflow and one connector', bindingWhere);
  describe('a binding that is refused binds nothing', refusingBinding);
  describe('a binding the facts refuse binds nothing', refusingBindingByFacts);
  describe('a binding to nothing answers what is missing', missing);
  describe('unbinding needs manage', unbinding);
  describe('unbinding removes one binding', unbindingOne);
});
