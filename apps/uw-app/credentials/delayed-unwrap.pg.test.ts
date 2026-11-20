import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Principal } from '@uw/contracts';
import { personPrincipal } from '@uw/core/principal';
import { testServer } from '@uw/db/test-database';
import { revokeSeededGrant, seedGrant, seedPerson } from '@uw/db/test-seed';
import { pgWorld, type PgWorld } from '../testing/credentials-world.ts';
import { openCredential, type OpenRequest } from './open.ts';
import { createCredential, rotateCredential, type CredentialsDeps } from './store.ts';
import {
  bind,
  bytes,
  counts,
  duringGenerate,
  duringUnwrap,
  grantReveal,
  harnessId,
  logOf,
  now,
  person,
  revokeRevealRow,
  rewrite,
  runId,
  textOf,
  traceId,
  unbindRow,
} from './testing/store-world.ts';

let world: PgWorld;

const later = new Date('2026-11-20T09:00:04.000Z');
const grantEnds = new Date('2026-11-20T09:00:02.000Z');
const soon = new Date('2026-11-20T10:00:00.000Z');
const send = { harnessId, connectorKey: 'send' } as const;

function use(credentialId: string): OpenRequest {
  return { action: 'use', credentialId, usedBy: send, runId };
}

function reveal(credentialId: string): OpenRequest {
  return { action: 'reveal', credentialId };
}

type Delay = { readonly change: () => Promise<void>; readonly clockAfter?: Date };

function delayed(delay: Delay): CredentialsDeps {
  let current = now;
  const change = async () => {
    await delay.change();
    current = delay.clockAfter ?? later;
  };
  return {
    ...world.deps,
    keys: duringUnwrap(world.keys, change),
    clock: { now: () => new Date(current) },
  };
}

type Leaver = { readonly actor: Principal; readonly grantId: string };

async function leaver(n: number, role: 'editor' | 'admin' = 'editor'): Promise<Leaver> {
  const personId = `00000000-0000-4000-8000-0000001577a${n}`;
  const grantId = `00000000-0000-4000-8000-0000001577b${n}`;
  const email = `cred-leaver-${n}@example.org`;
  await seedPerson(world.db, { id: personId, email });
  const held = { role, scopeKind: 'jd_area', scopeArea: '20-29', expiresAt: null } as const;
  const grantedAt = new Date('2026-11-01T09:00:00.000Z');
  await seedGrant(world.db, { id: grantId, personId, ...held, grantedAt });
  const grants = [{ grantId, ...held }];
  return { actor: personPrincipal({ personId, email, grants, interactive: true }), grantId };
}

async function expectRefusedAndRecorded(id: string, action: string, reason: string) {
  const log = await logOf(world.db, id);
  expect(log.at(-1)).toMatchObject({ action, outcome: 'refused', reason });
  expect(log.filter((entry) => entry.action === action && entry.outcome === 'done')).toEqual([]);
}

function withdrawnReveals(): void {
  it('refuses a reveal whose credential was revoked while the key service answered', async () => {
    const id = await world.created('Revoked mid-reveal');
    await grantReveal(world.db, id, 'viewer', { expiresAt: soon });
    const deps = delayed({ change: () => rewrite(world.db, id, { revokedAt: now }) });
    expect(await openCredential(deps, person('viewer'), reveal(id), traceId)).toEqual({
      ok: false,
      reason: 'credential_revoked',
    });
    await expectRefusedAndRecorded(id, 'reveal', 'credential_revoked');
  });

  it('refuses a reveal whose grant ran out while the key service answered', async () => {
    const id = await world.created('Grant expired mid-reveal');
    await grantReveal(world.db, id, 'viewer', { expiresAt: grantEnds });
    const deps = delayed({ change: () => Promise.resolve() });
    expect(await openCredential(deps, person('viewer'), reveal(id), traceId)).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
    await expectRefusedAndRecorded(id, 'reveal', 'not_permitted');
  });

  it('refuses a reveal whose grant was revoked while the key service answered', async () => {
    const id = await world.created('Grant revoked mid-reveal');
    await grantReveal(world.db, id, 'viewer', { expiresAt: soon });
    const deps = delayed({ change: () => revokeRevealRow(world.db, id, now) });
    expect(await openCredential(deps, person('viewer'), reveal(id), traceId)).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
    await expectRefusedAndRecorded(id, 'reveal', 'not_permitted');
  });

  it('refuses a credential that expired while the key service answered', async () => {
    const id = await world.created('Expired mid-reveal');
    await grantReveal(world.db, id, 'viewer', { expiresAt: soon });
    await rewrite(world.db, id, { expiresAt: grantEnds });
    const deps = delayed({ change: () => Promise.resolve() });
    expect(await openCredential(deps, person('viewer'), reveal(id), traceId)).toEqual({
      ok: false,
      reason: 'credential_expired',
    });
    await expectRefusedAndRecorded(id, 'reveal', 'credential_expired');
  });
}

function withdrawnUses(): void {
  it('refuses a use whose binding was removed while the key service answered', async () => {
    const id = await world.created('Unbound mid-use');
    await bind(world.db, id);
    const deps = delayed({ change: () => unbindRow(world.db, id) });
    expect(await openCredential(deps, person('editor'), use(id), traceId)).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
    await expectRefusedAndRecorded(id, 'use', 'not_permitted');
  });

  it("refuses a use when the person's grant on the area was revoked while the key service answered", async () => {
    const id = await world.created('Grant on the area revoked mid-use');
    await bind(world.db, id);
    const { actor, grantId } = await leaver(1);
    const deps = delayed({ change: () => revokeSeededGrant(world.db, grantId, now) });
    expect(await openCredential(deps, actor, use(id), traceId)).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
    await expectRefusedAndRecorded(id, 'use', 'not_permitted');
  });

  it('refuses a use when the person was disabled while the key service answered', async () => {
    const id = await world.created('Person disabled mid-use');
    await bind(world.db, id);
    const { actor } = await leaver(2);
    const disable = async () => {
      await world.db.execute(
        sql`UPDATE people SET status = 'disabled' WHERE id = ${actor.personId}`,
      );
    };
    expect(await openCredential(delayed({ change: disable }), actor, use(id), traceId)).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
    await expectRefusedAndRecorded(id, 'use', 'not_permitted');
  });
}

function withdrawnWrites(): void {
  const sealing = (change: () => Promise<void>): CredentialsDeps => ({
    ...world.deps,
    keys: duringGenerate(world.keys, change),
  });
  const rotation = (credentialId: string) => ({
    credentialId,
    value: bytes('second value'),
    rotateBy: null,
    expiresAt: null,
  });

  it("refuses a rotation when the admin's grant was revoked while the key service answered", async () => {
    const id = await world.created('Admin left mid-rotation');
    const { actor, grantId } = await leaver(3, 'admin');
    const before = await counts(world.db);
    const deps = sealing(() => revokeSeededGrant(world.db, grantId, now));
    expect(await rotateCredential(deps, actor, rotation(id), traceId)).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
    expect(await counts(world.db)).toEqual({ ...before, log: (before['log'] ?? 0) + 1 });
    await expectRefusedAndRecorded(id, 'rotate', 'not_permitted');
  });

  it('refuses a rotation whose credential was revoked while the key service answered', async () => {
    const id = await world.created('Revoked mid-rotation');
    const deps = sealing(() => rewrite(world.db, id, { revokedAt: now }));
    expect(await rotateCredential(deps, person('admin'), rotation(id), traceId)).toEqual({
      ok: false,
      reason: 'credential_revoked',
    });
    await expectRefusedAndRecorded(id, 'rotate', 'credential_revoked');
  });

  it("creates nothing when the admin's grant was revoked while the key service answered", async () => {
    const { actor, grantId } = await leaver(4, 'admin');
    const before = await counts(world.db);
    const deps = sealing(() => revokeSeededGrant(world.db, grantId, now));
    const input = world.input('Admin left mid-creation');
    expect(await createCredential(deps, actor, input, traceId)).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
    expect(await counts(world.db)).toEqual(before);
  });
}

function ordering(): void {
  it('waits for a revocation that holds the credential row, and lets it win', async () => {
    const id = await world.created('Revocation in flight');
    await bind(world.db, id);
    let committed: Promise<void> = Promise.resolve();
    const change = () =>
      new Promise<void>((locked) => {
        committed = world.db.transaction(async (tx) => {
          await tx.execute(
            sql`UPDATE credentials SET revoked_at = ${now.toISOString()}::timestamptz WHERE id = ${id}`,
          );
          locked();
          await new Promise((resolve) => setTimeout(resolve, 300));
        });
      });
    const outcome = await openCredential(delayed({ change }), person('editor'), use(id), traceId);
    await committed;
    expect(outcome).toEqual({ ok: false, reason: 'credential_revoked' });
    await expectRefusedAndRecorded(id, 'use', 'credential_revoked');
  });

  it('still opens when nothing changed, and stamps the record with the time of the final check', async () => {
    const id = await world.created('Unchanged', 'the unchanged value');
    await bind(world.db, id);
    const deps = delayed({ change: () => Promise.resolve() });
    const opened = await openCredential(deps, person('editor'), use(id), traceId);
    expect(opened.ok && textOf(opened.value)).toBe('the unchanged value');
    const rows = await world.db.execute<{ at: Date }>(
      sql`SELECT at FROM credential_access_log
          WHERE credential_id = ${id} AND action = 'use' AND outcome = 'done'`,
    );
    expect([...rows].map((row) => new Date(row.at).toISOString())).toEqual([later.toISOString()]);
  });

  it('records a revocation that lands after the release as the later event', async () => {
    const id = await world.created('Revoked after release');
    await bind(world.db, id);
    const opened = await openCredential(world.deps, person('editor'), use(id), traceId);
    await rewrite(world.db, id, { revokedAt: later });
    expect(opened.ok).toBe(true);
    expect((await logOf(world.db, id)).at(-1)).toMatchObject({ action: 'use', outcome: 'done' });
  });
}

function wiping(): void {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function lastDecrypted(spy: { mock: { results: { value: unknown }[] } }) {
    const last = await spy.mock.results.at(-1)?.value;
    if (!(last instanceof ArrayBuffer)) throw new Error('nothing was decrypted');
    return [...new Uint8Array(last)];
  }

  it('zeroes the decrypted bytes when the final check refuses', async () => {
    const id = await world.created('Wiped on refusal', 'a value to wipe');
    await bind(world.db, id);
    const spy = vi.spyOn(crypto.subtle, 'decrypt');
    const deps = delayed({ change: () => rewrite(world.db, id, { revokedAt: now }) });
    const outcome = await openCredential(deps, person('editor'), use(id), traceId);
    expect(outcome.ok).toBe(false);
    const bytes = await lastDecrypted(spy);
    expect(bytes).toHaveLength('a value to wipe'.length);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  });

  it('zeroes the decrypted bytes when the final check throws', async () => {
    const id = await world.created('Wiped on a throw', 'a value to wipe');
    await bind(world.db, id);
    const spy = vi.spyOn(crypto.subtle, 'decrypt');
    let asked = 0;
    const clock = {
      now: () => {
        asked += 1;
        if (asked > 1) throw new Error('the clock stopped');
        return new Date(now);
      },
    };
    const deps = { ...world.deps, clock };
    await expect(openCredential(deps, person('editor'), use(id), traceId)).rejects.toThrow(
      'the clock stopped',
    );
    const bytes = await lastDecrypted(spy);
    expect(bytes).toHaveLength('a value to wipe'.length);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
    expect((await logOf(world.db, id)).filter((entry) => entry.action === 'use')).toEqual([]);
  });
}

describe.skipIf(!testServer)('#157 access is checked again after the key service answers', () => {
  beforeAll(async () => {
    world = await pgWorld(testServer ?? '');
  });

  afterAll(async () => {
    await world.drop();
  });

  describe('a reveal withdrawn during the unwrap is refused and recorded', withdrawnReveals);
  describe('a use withdrawn during the unwrap is refused and recorded', withdrawnUses);
  describe('a write withdrawn while the value was sealed is refused', withdrawnWrites);
  describe('the final check and a revocation are serialised', ordering);
  describe('a value that is not released is wiped', wiping);
});
