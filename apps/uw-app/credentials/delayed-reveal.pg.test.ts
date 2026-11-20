import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@uw/contracts';
import { personPrincipal } from '@uw/core/principal';
import { testServer } from '@uw/db/test-database';
import { revokeSeededGrant, seedGrant, seedPerson } from '@uw/db/test-seed';
import { pgWorld, type PgWorld } from '../testing/credentials-world.ts';
import { revealCredential, type RevealDeps } from './reveal.ts';
import { confirmRevealGrant, giveRevealGrant, revokeRevealGrant } from './reveal-grants.ts';
import { revokeCredential } from './revoke.ts';
import type { RevealNotice } from './tell-admins.ts';
import {
  duringUnwrap,
  logOf,
  now,
  people,
  person,
  secondOrgAdmin,
  traceId,
} from './testing/store-world.ts';

let world: PgWorld;

const later = new Date('2026-11-20T09:00:04.000Z');

type Delayed = { readonly deps: RevealDeps; readonly told: RevealNotice[] };

function delayed(change: () => Promise<void>): Delayed {
  let current = now;
  const told: RevealNotice[] = [];
  const changed = async () => {
    await change();
    current = later;
  };
  const deps: RevealDeps = {
    ...world.deps,
    keys: duringUnwrap(world.keys, changed),
    clock: { now: () => new Date(current) },
    tell: async (notice) => {
      told.push(notice);
    },
  };
  return { deps, told };
}

async function granted(credentialId: string, personId: string = people.viewer): Promise<string> {
  const request = { credentialId, personId, minutes: 60 };
  const given = await giveRevealGrant(world.deps, person('admin'), request, traceId);
  if (!given.ok) throw new Error(`the reveal grant was refused: ${given.reason}`);
  return given.grantId;
}

async function reveals(credentialId: string) {
  const log = await logOf(world.db, credentialId);
  return log
    .filter((entry) => entry.action === 'reveal')
    .map((entry) => `${entry.outcome} ${entry.reason ?? ''}`.trim());
}

async function onlooker(
  n: number,
): Promise<{ readonly actor: Principal; readonly grantId: string }> {
  const personId = `00000000-0000-4000-8000-0000001599a${n}`;
  const grantId = `00000000-0000-4000-8000-0000001599b${n}`;
  const email = `cred-onlooker-${n}@example.org`;
  await seedPerson(world.db, { id: personId, email });
  const held = {
    role: 'viewer',
    scopeKind: 'jd_area',
    scopeArea: '20-29',
    expiresAt: null,
  } as const;
  const grantedAt = new Date('2026-11-01T09:00:00.000Z');
  await seedGrant(world.db, { id: grantId, personId, ...held, grantedAt });
  const grants = [{ grantId, ...held }];
  return { actor: personPrincipal({ personId, email, grants, interactive: true }), grantId };
}

function withdrawn(): void {
  it('returns no value and tells nobody when the credential was revoked during the unwrap', async () => {
    const id = await world.created('Revoked mid-reveal, on the screen');
    await granted(id);
    const run = delayed(async () => {
      const outcome = await revokeCredential(world.deps, person('admin'), id, traceId);
      expect(outcome).toEqual({ ok: true });
    });
    expect(await revealCredential(run.deps, person('viewer'), id, traceId)).toEqual({
      ok: false,
      reason: 'credential_revoked',
    });
    expect(run.told).toEqual([]);
    expect(await reveals(id)).toEqual(['refused credential_revoked']);
  });

  it('returns no value when the reveal grant was revoked during the unwrap', async () => {
    const id = await world.created('Grant revoked mid-reveal, on the screen');
    const grantId = await granted(id);
    const run = delayed(async () => {
      const outcome = await revokeRevealGrant(world.deps, person('admin'), grantId, traceId);
      expect(outcome).toEqual({ ok: true });
    });
    expect(await revealCredential(run.deps, person('viewer'), id, traceId)).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
    expect(run.told).toEqual([]);
    expect(await reveals(id)).toEqual(['refused not_permitted']);
  });

  it('still reveals, and tells the admins, when nothing changed during the unwrap', async () => {
    const id = await world.created('Unchanged mid-reveal, on the screen', 'the value shown');
    await granted(id);
    const run = delayed(() => Promise.resolve());
    expect(await revealCredential(run.deps, person('viewer'), id, traceId)).toEqual({
      ok: true,
      value: 'the value shown',
    });
    expect(run.told).toHaveLength(1);
    expect(await reveals(id)).toEqual(['done']);
  });
}

function breakGlass(): void {
  it('does not count a break-glass grant nobody confirmed, given during the unwrap in place of a revoked one', async () => {
    const id = await world.created('Swapped for an unconfirmed grant');
    const first = await granted(id);
    const swap = async () => {
      await revokeRevealGrant(world.deps, person('admin'), first, traceId);
      const request = { credentialId: id, personId: people.viewer, minutes: 60 };
      const given = await giveRevealGrant(world.deps, person('orgAdmin'), request, traceId);
      expect(given).toMatchObject({ ok: true, waitsForSecond: true });
    };
    const run = delayed(swap);
    expect(await revealCredential(run.deps, person('viewer'), id, traceId)).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
    expect(run.told).toEqual([]);
    expect(await reveals(id)).toEqual(['refused not_permitted']);
  });

  it('counts a break-glass grant once a second org admin confirmed it', async () => {
    const id = await world.created('Confirmed break-glass grant', 'shown after two admins');
    const request = { credentialId: id, personId: people.viewer, minutes: 60 };
    const given = await giveRevealGrant(world.deps, person('orgAdmin'), request, traceId);
    const grantId = given.ok ? given.grantId : '';
    const refusedFirst = await revealCredential(
      delayed(() => Promise.resolve()).deps,
      person('viewer'),
      id,
      traceId,
    );
    expect(refusedFirst).toEqual({ ok: false, reason: 'not_permitted' });
    expect(await confirmRevealGrant(world.deps, secondOrgAdmin(), grantId, traceId)).toEqual({
      ok: true,
    });
    const run = delayed(() => Promise.resolve());
    expect(await revealCredential(run.deps, person('viewer'), id, traceId)).toEqual({
      ok: true,
      value: 'shown after two admins',
    });
  });
}

function hiding(): void {
  it('answers credential_not_found to someone who stopped seeing the credential during the unwrap', async () => {
    const id = await world.created('Hidden mid-reveal');
    const { actor, grantId } = await onlooker(1);
    await granted(id, actor.personId ?? '');
    const run = delayed(() => revokeSeededGrant(world.db, grantId, now));
    expect(await revealCredential(run.deps, actor, id, traceId)).toEqual({
      ok: false,
      reason: 'credential_not_found',
    });
    expect(run.told).toEqual([]);
    expect(await reveals(id)).toEqual(['refused not_permitted']);
  });
}

function serialised(): void {
  async function heldBehindTheRow(id: string, change: () => Promise<unknown>): Promise<unknown> {
    let settled = false;
    let changing: Promise<unknown> = Promise.resolve();
    await world.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM credentials WHERE id = ${id} FOR UPDATE`);
      changing = change().then((outcome) => {
        settled = true;
        return outcome;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
    });
    return changing;
  }

  it('makes a revocation of the credential wait for whoever holds its row', async () => {
    const id = await world.created('Revocation behind the lock');
    const revoke = () => revokeCredential(world.deps, person('admin'), id, traceId);
    expect(await heldBehindTheRow(id, revoke)).toEqual({ ok: true });
  });

  it('makes a revocation of a reveal grant wait for whoever holds the credential row', async () => {
    const id = await world.created('Grant revocation behind the lock');
    const grantId = await granted(id);
    const revoke = () => revokeRevealGrant(world.deps, person('admin'), grantId, traceId);
    expect(await heldBehindTheRow(id, revoke)).toEqual({ ok: true });
  });

  it('makes a break-glass confirmation wait for whoever holds the credential row', async () => {
    const id = await world.created('Confirmation behind the lock');
    const request = { credentialId: id, personId: people.viewer, minutes: 60 };
    const given = await giveRevealGrant(world.deps, person('orgAdmin'), request, traceId);
    const grantId = given.ok ? given.grantId : '';
    const confirm = () => confirmRevealGrant(world.deps, secondOrgAdmin(), grantId, traceId);
    expect(await heldBehindTheRow(id, confirm)).toEqual({ ok: true });
  });
}

describe.skipIf(!testServer)('#159 a reveal is checked again after the key service answers', () => {
  beforeAll(async () => {
    world = await pgWorld(testServer ?? '');
  });

  afterAll(async () => {
    await world.drop();
  });

  describe('a reveal withdrawn during the unwrap shows nothing', withdrawn);
  describe('an unconfirmed break-glass grant never counts at the final check', breakGlass);
  describe('existence stays hidden at the final check', hiding);
  describe('revocations and confirmations take the credential row lock', serialised);
});
