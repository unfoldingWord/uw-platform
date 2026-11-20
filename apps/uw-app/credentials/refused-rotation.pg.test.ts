import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testServer } from '@uw/db/test-database';
import { pgWorld, type PgWorld } from '../testing/credentials-world.ts';
import { rotateCredential } from './store.ts';
import { counts, logOf, people, person, traceId } from './testing/store-world.ts';

let world: PgWorld;

describe.skipIf(!testServer)('#157 a rotation refused for its value is recorded', () => {
  beforeAll(async () => {
    world = await pgWorld(testServer ?? '');
  });

  afterAll(async () => {
    await world.drop();
  });

  it.each([
    ['an empty value', new Uint8Array(0)],
    ['a value of 65,537 bytes', new Uint8Array(65_537)],
  ])('refuses %s, adds no version and records the refusal', async (name, value) => {
    const id = await world.created(`Rotation with ${name}`);
    const before = await counts(world.db);
    const outcome = await rotateCredential(
      world.deps,
      person('admin'),
      { credentialId: id, value, rotateBy: null, expiresAt: null },
      traceId,
    );
    expect(outcome).toEqual({ ok: false, reason: 'value_not_storable' });
    expect(await counts(world.db)).toEqual({ ...before, log: (before['log'] ?? 0) + 1 });
    expect((await logOf(world.db, id)).at(-1)).toMatchObject({
      action: 'rotate',
      outcome: 'refused',
      reason: 'value_not_storable',
      actor: `human:${people.admin}`,
      version_id: null,
    });
  });

  it('still stores a value of exactly 65,536 bytes', async () => {
    const id = await world.created('Rotation at the limit');
    const outcome = await rotateCredential(
      world.deps,
      person('admin'),
      { credentialId: id, value: new Uint8Array(65_536).fill(7), rotateBy: null, expiresAt: null },
      traceId,
    );
    expect(outcome).toMatchObject({ ok: true, version: 2 });
  });
});
