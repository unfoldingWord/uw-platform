import {
  principalSchema,
  type Harness,
  type JdArea,
  type Principal,
  type Role,
  type Scope,
  type Stage,
} from '@uw/contracts';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import type { Caller, Template } from '@uw/harness';
import type { World } from './world.ts';

const ianPersonId = '00000000-0000-4000-8000-000000000001';

export type SimGrant = {
  readonly role: Role;
  readonly scopeKind: Scope;
  readonly scopeArea: JdArea | null;
  readonly expiresAt?: Date | null;
};

function twoDigits(n: number): string {
  return n.toString(10).padStart(2, '0');
}

export function simPersonId(n: number): string {
  return `00000000-0000-4000-8000-0000000001${twoDigits(n)}`;
}

function simGrantId(n: number, index: number): string {
  return `00000000-0000-4000-8000-00000002${twoDigits(n)}${twoDigits(index)}`;
}

async function personaOf(world: World, personId: string, email: string): Promise<Principal> {
  const grants = await world.adapters.grants.resolve(personId, world.adapters.clock.now());
  return principalSchema.parse({
    identity: `human:${personId}`,
    kind: 'person',
    personId,
    email,
    grants,
    interactive: true,
  });
}

export async function simPerson(
  world: World,
  n: number,
  grants: readonly SimGrant[],
): Promise<Principal> {
  const personId = simPersonId(n);
  const email = `person${n}@unfoldingword.org`;
  const { db } = world.database;
  await seedPerson(db, { id: personId, email });
  for (const [index, grant] of grants.entries()) {
    await seedGrant(db, {
      id: simGrantId(n, index),
      personId,
      role: grant.role,
      scopeKind: grant.scopeKind,
      scopeArea: grant.scopeArea,
      grantedAt: world.adapters.clock.now(),
      expiresAt: grant.expiresAt ?? null,
    });
  }
  return personaOf(world, personId, email);
}

export function simIan(world: World): Promise<Principal> {
  return personaOf(world, ianPersonId, 'ian.lindsley@unfoldingword.org');
}

export function simAgent(
  owner: Principal,
  persona: string,
  options: { readonly interactive: boolean },
): Principal {
  return principalSchema.parse({
    identity: `agent:${persona}`,
    kind: 'agent',
    personId: owner.personId,
    email: null,
    grants: owner.grants,
    interactive: options.interactive,
  });
}

export function simCaller(world: World, actor: Principal): Caller {
  return { actor, traceId: world.adapters.ids.next() };
}

export async function createSimHarness(
  world: World,
  template: Template,
  options: { readonly key?: string; readonly jdArea?: JdArea } = {},
): Promise<{
  readonly harness: Harness;
  readonly stages: readonly Stage[];
  readonly admin: Principal;
}> {
  const admin = await simIan(world);
  const outcome = await world.kernel.stages.activate(simCaller(world, admin), {
    harnessId: world.adapters.ids.next(),
    harnessKey: options.key ?? template.key,
    jdArea: options.jdArea ?? '80-89',
    template,
  });
  if (outcome.status !== 'accepted') {
    throw new Error(`activating ${template.key} was refused: ${outcome.reason}`);
  }
  return { harness: outcome.value.harness, stages: outcome.value.stages, admin };
}
