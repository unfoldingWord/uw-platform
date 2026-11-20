import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testServer } from '@uw/db/test-database';
import { pgWorld, type PgWorld } from '../testing/credentials-world.ts';
import { rotateCredential } from './store.ts';
import { bytes, counts, logOf, people, person, traceId } from './testing/store-world.ts';

let world: PgWorld;

function unstorableValues(): void {
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
}

function malformedDates(): void {
  it('refuses a rotation whose rotate-by date is not a date, and records the refusal', async () => {
    const id = await world.created('Rotation with a bad date');
    const before = await counts(world.db);
    const input = { credentialId: id, value: bytes('x'), rotateBy: 'tomorrow', expiresAt: null };
    expect(await rotateCredential(world.deps, person('admin'), input, traceId)).toEqual({
      ok: false,
      reason: 'credential_malformed',
    });
    expect(await counts(world.db)).toEqual({ ...before, log: (before['log'] ?? 0) + 1 });
    expect((await logOf(world.db, id)).at(-1)).toMatchObject({
      action: 'rotate',
      outcome: 'refused',
      reason: 'credential_malformed',
    });
  });

  it('tells someone who cannot see the credential nothing about a bad date', async () => {
    const id = await world.created('Rotation with a bad date, by an outsider');
    const input = { credentialId: id, value: bytes('x'), rotateBy: 'tomorrow', expiresAt: null };
    expect(await rotateCredential(world.deps, person('outsider'), input, traceId)).toEqual({
      ok: false,
      reason: 'credential_not_found',
    });
    expect((await logOf(world.db, id)).at(-1)).toMatchObject({
      action: 'rotate',
      outcome: 'refused',
      reason: 'not_permitted',
    });
  });
}

describe.skipIf(!testServer)('#157 a rotation refused for its value is recorded', () => {
  beforeAll(async () => {
    world = await pgWorld(testServer ?? '');
  });

  afterAll(async () => {
    await world.drop();
  });

  describe('a value that cannot be stored', unstorableValues);
  describe('a rotate-by date that is not a date', malformedDates);
});
