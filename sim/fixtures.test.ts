import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { simAgent, simCaller, simIan, simPerson, simPersonId, simSystem } from './fixtures.ts';
import { createWorld, type World } from './world.ts';

afterAll(closeEmbeddedTemplate);

const worldTimeout = 60_000;

async function checkEditor(world: World): Promise<void> {
  const person = await simPerson(world, 3, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  expect(person).toMatchObject({
    identity: `human:${simPersonId(3)}`,
    kind: 'person',
    email: 'person3@unfoldingword.org',
    interactive: true,
  });
  expect(person.grants).toEqual([
    {
      grantId: '00000000-0000-4000-8000-000000020300',
      role: 'editor',
      scopeKind: 'jd_area',
      scopeArea: '80-89',
      expiresAt: null,
    },
  ]);
  const builder = simAgent(person, 'builder', { interactive: false });
  expect(builder).toMatchObject({
    identity: 'agent:builder',
    kind: 'agent',
    personId: person.personId,
    grants: person.grants,
    interactive: false,
  });
}

async function inWorld(check: (world: World) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await check(world);
  } finally {
    await world.close();
  }
}

describe('DX-4 sim fixtures build principals from the seeded people and grants', () => {
  it('builds the system principal with no person and no grants', () => {
    expect(simSystem()).toMatchObject({ identity: 'agent:system', personId: null, grants: [] });
  });

  it('numbers people and their grants by the formula', () => {
    expect(simPersonId(3)).toBe('00000000-0000-4000-8000-000000000103');
  });

  it(
    'builds a person principal whose one grant is the seeded editor grant',
    () => inWorld(checkEditor),
    worldTimeout,
  );

  it(
    'builds the bootstrap person and a caller with a fresh trace id',
    async () => {
      const world = await createWorld();
      try {
        const ian = await simIan(world);
        expect(ian.identity).toBe('human:00000000-0000-4000-8000-000000000001');
        expect(ian.grants.map((grant) => grant.role)).toEqual(['admin']);
        const caller = simCaller(world, ian);
        expect(caller.actor).toBe(ian);
        expect(caller.traceId).not.toBe(simCaller(world, ian).traceId);
      } finally {
        await world.close();
      }
    },
    worldTimeout,
  );
});
