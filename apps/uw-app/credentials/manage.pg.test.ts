import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testServer } from '@uw/db/test-database';
import { pgWorld, type PgWorld } from '../testing/credentials-world.ts';
import { bindCredential, unbindCredential } from './bindings.ts';
import { openCredential } from './open.ts';
import { confirmRevealGrant, giveRevealGrant, revokeRevealGrant } from './reveal-grants.ts';
import { revokeCredential } from './revoke.ts';
import { createCredential, rotateCredential } from './store.ts';
import {
  agentOf,
  bytes,
  grantsOf,
  harnessId,
  logOf,
  orgEditor,
  people,
  person,
  secondOrgAdmin,
  textOf,
  traceId,
} from './testing/store-world.ts';

let world: PgWorld;

const missing = '00000000-0000-4000-8000-00000000dead';
const reveal = (credentialId: string) => ({ action: 'reveal', credentialId }) as const;
const hour = (credentialId: string, personId: string) => ({ credentialId, personId, minutes: 60 });

function lastOf<T>(rows: readonly T[]): T | undefined {
  return rows.at(-1);
}

function revoking(): void {
  it('lets an area admin revoke: the row is marked, the log says so, and nothing opens it after', async () => {
    const id = await world.created('Revoked by its admin');
    await giveRevealGrant(world.deps, person('admin'), hour(id, people.viewer), traceId);
    expect(await revokeCredential(world.deps, person('admin'), id, traceId)).toEqual({ ok: true });
    expect(lastOf(await logOf(world.db, id))).toMatchObject({ action: 'revoke', outcome: 'done' });
    expect(await openCredential(world.deps, person('viewer'), reveal(id), traceId)).toEqual({
      ok: false,
      reason: 'credential_revoked',
    });
    const rotation = { credentialId: id, value: bytes('new'), rotateBy: null, expiresAt: null };
    expect(await rotateCredential(world.deps, person('admin'), rotation, traceId)).toEqual({
      ok: false,
      reason: 'credential_revoked',
    });
  });

  it('lets an org admin revoke in any area, and refuses a second revoke by its reason', async () => {
    const id = await world.created('Revoked by an org admin');
    expect(await revokeCredential(world.deps, person('orgAdmin'), id, traceId)).toEqual({
      ok: true,
    });
    expect(await revokeCredential(world.deps, person('orgAdmin'), id, traceId)).toEqual({
      ok: false,
      reason: 'credential_revoked',
    });
  });

  it.each([
    ['an editor on the area', () => person('editor')],
    ['a viewer on the area', () => person('viewer')],
  ])('refuses %s, who sees it, as not_permitted and logs the refusal', async (_name, actor) => {
    const id = await world.created(`Kept from ${_name}`);
    expect(await revokeCredential(world.deps, actor(), id, traceId)).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
    expect(lastOf(await logOf(world.db, id))).toMatchObject({
      action: 'revoke',
      outcome: 'refused',
      reason: 'not_permitted',
    });
  });
}

function givingReveal(): void {
  it('lets an area admin give a reveal grant that is live at once and ends on time', async () => {
    const id = await world.created('Revealed to a viewer');
    const before = await openCredential(world.deps, person('viewer'), reveal(id), traceId);
    expect(before).toEqual({ ok: false, reason: 'not_permitted' });
    const given = await giveRevealGrant(
      world.deps,
      person('admin'),
      hour(id, people.viewer),
      traceId,
    );
    expect(given).toMatchObject({ ok: true, waitsForSecond: false });
    expect(await grantsOf(world.db, id)).toMatchObject([
      { person_id: people.viewer, granted_by: people.admin, second_required: false, minutes: 60 },
    ]);
    const opened = await openCredential(world.deps, person('viewer'), reveal(id), traceId);
    expect(opened.ok && textOf(opened.value)).toBe('value of Revealed to a viewer');
    expect((await logOf(world.db, id)).map((row) => `${row.action} ${row.outcome}`)).toEqual([
      'create done',
      'reveal refused',
      'grant_reveal done',
      'reveal done',
    ]);
  });

  it('refuses a second live grant for the same person, and a grant for nobody', async () => {
    const id = await world.created('Granted once');
    await giveRevealGrant(world.deps, person('admin'), hour(id, people.viewer), traceId);
    expect(
      await giveRevealGrant(world.deps, person('admin'), hour(id, people.viewer), traceId),
    ).toEqual({ ok: false, reason: 'grant_exists' });
    expect(await giveRevealGrant(world.deps, person('admin'), hour(id, missing), traceId)).toEqual({
      ok: false,
      reason: 'person_not_found',
    });
  });

  it.each([4, 1441, 60.5])('refuses a grant of %s minutes', async (minutes) => {
    const id = await world.created(`Odd minutes ${minutes}`);
    const grant = { credentialId: id, personId: people.viewer, minutes };
    expect(await giveRevealGrant(world.deps, person('admin'), grant, traceId)).toEqual({
      ok: false,
      reason: 'credential_malformed',
    });
  });
}

function refusingAGrant(): void {
  it('refuses a grant on a revoked credential', async () => {
    const id = await world.created('Revoked before a grant');
    await revokeCredential(world.deps, person('admin'), id, traceId);
    expect(
      await giveRevealGrant(world.deps, person('admin'), hour(id, people.viewer), traceId),
    ).toEqual({ ok: false, reason: 'credential_revoked' });
  });

  it.each([
    ['an editor on the area', () => person('editor')],
    ['an agent carrying an area admin grant', () => agentOf('admin')],
  ])('refuses %s', async (_name, actor) => {
    const id = await world.created(`No grant from ${_name}`);
    const outcome = await giveRevealGrant(world.deps, actor(), hour(id, people.viewer), traceId);
    expect(outcome.ok).toBe(false);
    expect(await grantsOf(world.db, id)).toEqual([]);
  });
}

function takingAGrantBack(): void {
  it('lets a manager revoke a reveal grant, after which the value stays shut', async () => {
    const id = await world.created('Grant taken back');
    const given = await giveRevealGrant(
      world.deps,
      person('admin'),
      hour(id, people.viewer),
      traceId,
    );
    const grantId = given.ok ? given.grantId : '';
    expect(await revokeRevealGrant(world.deps, person('editor'), grantId, traceId)).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
    expect(await revokeRevealGrant(world.deps, person('admin'), grantId, traceId)).toEqual({
      ok: true,
    });
    expect(await openCredential(world.deps, person('viewer'), reveal(id), traceId)).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
    expect(await revokeRevealGrant(world.deps, person('admin'), grantId, traceId)).toEqual({
      ok: false,
      reason: 'grant_not_found',
    });
  });
}

async function askedByAnOrgAdmin(id: string): Promise<string> {
  const asked = await giveRevealGrant(
    world.deps,
    person('orgAdmin'),
    hour(id, people.orgAdmin),
    traceId,
  );
  expect(asked).toMatchObject({ ok: true, waitsForSecond: true });
  return asked.ok ? asked.grantId : '';
}

function breakingGlass(): void {
  it('holds an org admin’s reveal grant until a second org admin confirms it, and records both', async () => {
    const id = await world.created('Break glass');
    const grantId = await askedByAnOrgAdmin(id);
    expect(await openCredential(world.deps, person('orgAdmin'), reveal(id), traceId)).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
    expect(await confirmRevealGrant(world.deps, person('orgAdmin'), grantId, traceId)).toEqual({
      ok: false,
      reason: 'second_admin_required',
    });
    expect(await openCredential(world.deps, person('orgAdmin'), reveal(id), traceId)).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
    expect(await confirmRevealGrant(world.deps, secondOrgAdmin(), grantId, traceId)).toEqual({
      ok: true,
    });
    expect(await grantsOf(world.db, id)).toMatchObject([
      {
        person_id: people.orgAdmin,
        granted_by: people.orgAdmin,
        second_required: true,
        second_by: people.outsider,
        minutes: 60,
      },
    ]);
    const opened = await openCredential(world.deps, person('orgAdmin'), reveal(id), traceId);
    expect(opened.ok && textOf(opened.value)).toBe('value of Break glass');
    const log = await logOf(world.db, id);
    expect(log.map((row) => `${row.action} ${row.outcome} ${row.person_id}`)).toEqual([
      `create done ${people.admin}`,
      `grant_reveal done ${people.orgAdmin}`,
      `reveal refused ${people.orgAdmin}`,
      `confirm_reveal refused ${people.orgAdmin}`,
      `reveal refused ${people.orgAdmin}`,
      `confirm_reveal done ${people.outsider}`,
      `reveal done ${people.orgAdmin}`,
    ]);
  });
}

function confirmingOnce(): void {
  it('refuses to confirm twice, to confirm an area admin’s grant, and to confirm as an org editor', async () => {
    const id = await world.created('Confirmed once');
    const asked = await giveRevealGrant(
      world.deps,
      person('orgAdmin'),
      hour(id, people.orgAdmin),
      traceId,
    );
    const pending = asked.ok ? asked.grantId : '';
    expect(await confirmRevealGrant(world.deps, orgEditor(), pending, traceId)).toEqual({
      ok: false,
      reason: 'grant_not_found',
    });
    await confirmRevealGrant(world.deps, secondOrgAdmin(), pending, traceId);
    expect(await confirmRevealGrant(world.deps, secondOrgAdmin(), pending, traceId)).toEqual({
      ok: false,
      reason: 'grant_not_found',
    });
    const plain = await giveRevealGrant(
      world.deps,
      person('admin'),
      hour(id, people.viewer),
      traceId,
    );
    const live = plain.ok ? plain.grantId : '';
    expect(await confirmRevealGrant(world.deps, secondOrgAdmin(), live, traceId)).toEqual({
      ok: false,
      reason: 'grant_not_found',
    });
  });
}

function secondIsAnAreaAdmin(): void {
  it('lets an area admin be the second person on an org admin’s grant', async () => {
    const id = await world.created('Second is the area admin');
    const asked = await giveRevealGrant(
      world.deps,
      person('orgAdmin'),
      hour(id, people.orgAdmin),
      traceId,
    );
    const grantId = asked.ok ? asked.grantId : '';
    expect(await confirmRevealGrant(world.deps, person('admin'), grantId, traceId)).toEqual({
      ok: true,
    });
  });
}

const outsider = () => person('outsider');
const send = { harnessId, connectorKey: 'send' } as const;
const rotation = (credentialId: string) => ({
  credentialId,
  value: bytes('new'),
  rotateBy: null,
  expiresAt: null,
});

async function everyAnswer(target: string) {
  return [
    await rotateCredential(world.deps, outsider(), rotation(target), traceId),
    await revokeCredential(world.deps, outsider(), target, traceId),
    await bindCredential(world.deps, outsider(), { credentialId: target, ...send }, traceId),
    await unbindCredential(world.deps, outsider(), { credentialId: target, ...send }, traceId),
    await giveRevealGrant(world.deps, outsider(), hour(target, people.viewer), traceId),
    await openCredential(world.deps, outsider(), reveal(target), traceId),
  ];
}

function hiding(): void {
  it('answers a person who cannot see a credential exactly as it answers for one that does not exist', async () => {
    const id = await world.created('Hidden from another area');
    const given = await giveRevealGrant(
      world.deps,
      person('admin'),
      hour(id, people.viewer),
      traceId,
    );
    const grantId = given.ok ? given.grantId : '';
    for (const target of [id, missing, 'not-an-id']) {
      const answers = await everyAnswer(target);
      expect(answers).toEqual(answers.map(() => ({ ok: false, reason: 'credential_not_found' })));
    }
    for (const target of [grantId, missing, 'not-an-id']) {
      expect(await revokeRevealGrant(world.deps, outsider(), target, traceId)).toEqual({
        ok: false,
        reason: 'grant_not_found',
      });
      expect(await confirmRevealGrant(world.deps, outsider(), target, traceId)).toEqual({
        ok: false,
        reason: 'grant_not_found',
      });
    }
    const refusals = (await logOf(world.db, id)).filter((row) => row.outcome === 'refused');
    expect(refusals.map((row) => `${row.action} ${row.reason} ${row.person_id}`)).toEqual(
      [
        'rotate',
        'revoke',
        'bind',
        'unbind',
        'grant_reveal',
        'reveal',
        'revoke_reveal',
        'confirm_reveal',
      ].map((action) => `${action} not_permitted ${people.outsider}`),
    );
  });
}

function malformedInput(): void {
  it('refuses a new credential whose owner, reference, name or date would be refused by the database', async () => {
    const input = world.input('Well formed');
    const malformed = [
      { ...input, ownerId: 'nobody' },
      { ...input, jdRef: '31' },
      { ...input, jdRef: '2x' },
      { ...input, name: ' padded' },
      { ...input, name: '' },
      { ...input, rotateBy: 'tomorrow' },
    ];
    for (const bad of malformed) {
      expect(await createCredential(world.deps, person('admin'), bad, traceId)).toEqual({
        ok: false,
        reason: 'credential_malformed',
      });
    }
    const unknown = { ...input, ownerId: missing };
    expect(await createCredential(world.deps, person('admin'), unknown, traceId)).toEqual({
      ok: false,
      reason: 'person_not_found',
    });
  });
}

describe.skipIf(!testServer)('#159 managing a credential', () => {
  beforeAll(async () => {
    world = await pgWorld(testServer ?? '');
  });

  afterAll(async () => {
    await world.drop();
  });

  describe('revoking a credential', revoking);
  describe('giving a reveal grant', givingReveal);
  describe('a reveal grant that is refused', refusingAGrant);
  describe('revoking a reveal grant', takingAGrantBack);
  describe('a reveal outside the area’s grants needs two org admins', breakingGlass);
  describe('a break-glass grant is confirmed once', confirmingOnce);
  describe('who may be the second person', secondIsAnAreaAdmin);
  describe('what a person who cannot see a credential is told', hiding);
  describe('input the database would refuse', malformedInput);
});
