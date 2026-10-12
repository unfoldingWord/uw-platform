import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { principalSchema, type Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { revokeSeededGrant, seedGrant, seedPerson } from '@uw/db/test-seed';
import { agentOf, kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import {
  accepted,
  callerOf,
  command,
  dispatchAs,
  dispatchScope,
  eventCount,
  eventsNamed,
  ian,
  softwareHarness,
} from '../testing/commands.ts';

const IAN_ID = '00000000-0000-4000-8000-000000000001';
const IAN = { email: 'ian.lindsley@unfoldingword.org' };
const DAY = 24 * 60 * 60 * 1000;

function tweak(overrides: Record<string, unknown> = {}) {
  return {
    requestId: randomUUID(),
    persona: 'agent:iterate',
    capability: 'iterate',
    expiresAt: new Date(Date.now() + 7 * DAY).toISOString(),
    supersedes: null,
    ...overrides,
  };
}

function iterate(owner: Principal): Principal {
  return principalSchema.parse({
    ...owner,
    identity: 'agent:iterate',
    kind: 'agent',
    email: null,
    interactive: false,
  });
}

async function delegationsOf(db: Database, harnessId: string) {
  const kernel = kernelOn(db, { now: () => new Date() });
  const filter = { personId: null, persona: null, harnessId };
  return accepted(await kernel.delegations.live(callerOf(await ian(db)), filter));
}

async function beat(db: Database, delegationId: string) {
  const kernel = kernelOn(db, { now: () => new Date() });
  return kernel.delegations.beat(callerOf(iterate(await ian(db))), { delegationId });
}

async function scheduled(db: Database): Promise<void> {
  const { harnessId } = await softwareHarness(db);
  const body = tweak();
  const sent = await command(db, IAN, harnessId, 'schedule_regular_tweak', body);
  expect(sent.body).toEqual({ status: 'accepted', requestId: body.requestId });
  const [delegation] = await delegationsOf(db, harnessId);
  expect(delegation).toMatchObject({
    personId: IAN_ID,
    persona: 'agent:iterate',
    capability: 'iterate',
    expiresAt: new Date(body.expiresAt),
    revokedAt: null,
  });
  const [event] = await eventsNamed(db, harnessId, 'delegation_granted');
  expect(event).toMatchObject({
    actor: `human:${IAN_ID}`,
    requestId: body.requestId,
    traceId: sent.traceId,
    evidence: { delegationId: delegation?.id, capability: 'iterate', persona: 'agent:iterate' },
  });
  const past = tweak({ expiresAt: new Date(Date.now() - DAY).toISOString() });
  const expired = await command(db, IAN, harnessId, 'schedule_regular_tweak', past);
  expect(expired.body).toMatchObject({ status: 'error', reason: 'expiry_in_past' });
}

async function revoked(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const { harnessId } = scene;
  await command(db, IAN, harnessId, 'schedule_regular_tweak', tweak());
  const [delegation] = await delegationsOf(db, harnessId);
  const delegationId = delegation?.id ?? '';
  expect((await beat(db, delegationId)).status).toBe('accepted');
  const editor = await command(db, scene.editor, harnessId, 'revoke_delegation', {
    requestId: randomUUID(),
    delegationId,
  });
  expect(editor.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const requestId = randomUUID();
  const sent = await command(db, IAN, harnessId, 'revoke_delegation', { requestId, delegationId });
  expect(sent.body).toEqual({ status: 'accepted', requestId });
  const [event] = await eventsNamed(db, harnessId, 'delegation_revoked');
  expect(event).toMatchObject({ requestId, evidence: { delegationId } });
  expect(await delegationsOf(db, harnessId)).toEqual([]);
  expect(await beat(db, delegationId)).toMatchObject({
    status: 'error',
    reason: 'delegation_lapsed',
  });
}

async function editorCannot(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const { harnessId } = scene;
  const before = await eventCount(db, harnessId);
  const body = tweak();
  const editor = await command(db, scene.editor, harnessId, 'schedule_regular_tweak', body);
  expect(editor.body).toEqual({
    status: 'error',
    requestId: body.requestId,
    reason: 'not_permitted',
  });
  const agent = agentOf(await ian(db), 'builder');
  const scope = dispatchScope(db);
  for (const [name, extra] of [
    ['schedule_regular_tweak', tweak()],
    ['revoke_delegation', { requestId: randomUUID(), delegationId: randomUUID() }],
  ] as const) {
    const outcome = await dispatchAs(agent, harnessId, name, extra, scope);
    expect(outcome).toEqual({
      status: 'error',
      requestId: extra.requestId,
      reason: 'not_permitted',
    });
  }
  expect(await delegationsOf(db, harnessId)).toEqual([]);
  expect(await eventCount(db, harnessId)).toBe(before);
}

async function foreignSupersedes(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  await command(db, IAN, scene.otherHarnessId, 'schedule_regular_tweak', tweak());
  const [elsewhere] = await delegationsOf(db, scene.otherHarnessId);
  const requestId = randomUUID();
  const send = (supersedes: string) =>
    command(db, IAN, scene.harnessId, 'schedule_regular_tweak', tweak({ requestId, supersedes }));
  const foreign = await send(elsewhere?.id ?? '');
  const missing = await send(randomUUID());
  expect(foreign.body).toEqual({ status: 'error', requestId, reason: 'delegation_not_found' });
  expect(foreign.text).toBe(missing.text);
  expect(await delegationsOf(db, scene.harnessId)).toEqual([]);
  expect(await delegationsOf(db, scene.otherHarnessId)).toHaveLength(1);
}

async function grantedTo(db: Database, personId: string, role: 'admin' | 'editor') {
  const grantId = randomUUID();
  await seedGrant(db, {
    id: grantId,
    personId,
    role,
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: new Date(Date.now() - 60_000),
    expiresAt: null,
  });
  return grantId;
}

async function ownerRevokesWithoutAdmin(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const { harnessId } = scene;
  const owner = { id: randomUUID(), email: 'owner@unfoldingword.org' };
  await seedPerson(db, owner);
  const adminGrant = await grantedTo(db, owner.id, 'admin');
  await grantedTo(db, owner.id, 'editor');
  await command(db, owner, harnessId, 'schedule_regular_tweak', tweak());
  const [delegation] = await delegationsOf(db, harnessId);
  const delegationId = delegation?.id ?? '';
  await revokeSeededGrant(db, adminGrant, new Date());
  const revoke = (who: { readonly email: string }) =>
    command(db, who, harnessId, 'revoke_delegation', { requestId: randomUUID(), delegationId });
  expect((await revoke(scene.editor)).body).toMatchObject({ reason: 'not_permitted' });
  expect(await delegationsOf(db, harnessId)).toHaveLength(1);
  const before = await eventCount(db, harnessId);
  expect((await revoke(owner)).body).toMatchObject({ status: 'accepted' });
  expect(await delegationsOf(db, harnessId)).toEqual([]);
  const [event] = await eventsNamed(db, harnessId, 'delegation_revoked');
  expect(event).toMatchObject({ actor: `human:${owner.id}`, evidence: { delegationId } });
  expect(await eventCount(db, harnessId)).toBe(before + 1);
}

describe.skipIf(!testServer)('WB-1 KN-16 the delegation commands on the person surface', () => {
  it('WB-1 schedule_regular_tweak writes a delegation for the admin with the capability word and expiry', () =>
    withAppDatabase(scheduled));

  it('WB-1 revoke_delegation revokes it and records delegation_revoked, and the next beat lapses', () =>
    withAppDatabase(revoked));

  it('WB-1 an editor cannot schedule a regular tweak, nor can an agent schedule or revoke', () =>
    withAppDatabase(editorCannot));

  it('schedule_regular_tweak superseding a delegation of another harness is delegation_not_found, as for a missing one', () =>
    withAppDatabase(foreignSupersedes));

  it('WB-1 KN-16 the owner of a delegation revokes it without admin, and another person without admin cannot', () =>
    withAppDatabase(ownerRevokesWithoutAdmin));
});
