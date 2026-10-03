import {
  ingestIdentity,
  principalSchema,
  systemIdentity,
  type Harness,
  type ItemState,
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

export function simSystem(): Principal {
  return principalSchema.parse({
    identity: systemIdentity,
    kind: 'agent',
    personId: null,
    email: null,
    grants: [],
    interactive: false,
  });
}

export function simIngest(): Principal {
  return principalSchema.parse({
    identity: ingestIdentity,
    kind: 'agent',
    personId: null,
    email: null,
    grants: [],
    interactive: false,
  });
}

export function simCaller(world: World, actor: Principal, requestId: string | null = null): Caller {
  return { actor, traceId: world.adapters.ids.next(), requestId };
}

type SimHarnessOptions = {
  readonly key?: string;
  readonly jdArea?: JdArea;
  readonly repository?: string | null;
};

function defaultRepository(template: Template, key: string): string | null {
  if (template.key !== 'software') return null;
  return key === template.key ? 'unfoldingWord/uw-platform' : `unfoldingWord/${key}`;
}

export async function createSimHarness(
  world: World,
  template: Template,
  options: SimHarnessOptions = {},
): Promise<{
  readonly harness: Harness;
  readonly stages: readonly Stage[];
  readonly admin: Principal;
}> {
  const admin = await simIan(world);
  const harnessKey = options.key ?? template.key;
  const outcome = await world.kernel.stages.activate(simCaller(world, admin), {
    harnessId: world.adapters.ids.next(),
    harnessKey,
    jdArea: options.jdArea ?? '80-89',
    template,
    repository:
      options.repository === undefined
        ? defaultRepository(template, harnessKey)
        : options.repository,
  });
  if (outcome.status !== 'accepted') {
    throw new Error(`activating ${template.key} was refused: ${outcome.reason}`);
  }
  return { harness: outcome.value.harness, stages: outcome.value.stages, admin };
}

export type AdvanceInput = {
  readonly harnessId: string;
  readonly itemId: string;
  readonly worker: Principal;
  readonly through: readonly string[];
};

export async function simAdvance(world: World, input: AdvanceInput): Promise<ItemState> {
  const caller = simCaller(world, input.worker);
  let item: ItemState | null = null;
  for (const stageKey of input.through) {
    const where = `${stageKey} in ${input.harnessId}`;
    const claimed = await world.kernel.items.claim(caller, {
      itemId: input.itemId,
      delegationId: null,
    });
    if (claimed.status !== 'accepted')
      throw new Error(`claiming ${where} was refused: ${claimed.reason}`);
    const submitted = await world.kernel.items.submit(caller, {
      itemId: input.itemId,
      to: null,
      evidence: {},
      change: null,
    });
    if (submitted.status !== 'accepted') {
      throw new Error(`submitting ${where} was refused: ${submitted.reason}`);
    }
    item = submitted.value.item;
  }
  if (item === null) throw new Error('advance needs at least one stage to pass through');
  return item;
}

export type ParkInput = {
  readonly harnessId: string;
  readonly admin: Principal;
  readonly title: string;
};

type HeldInput = ParkInput & {
  readonly agent: Principal;
  readonly delegationId: string | null;
};

async function enqueuedAtGatedCheck(world: World, input: ParkInput): Promise<string> {
  const caller = simCaller(world, input.admin);
  const gated = await world.kernel.stages.updateStage(caller, {
    harnessId: input.harnessId,
    stageKey: 'check',
    change: { exitGate: 'human_approval' },
  });
  if (gated.status !== 'accepted') throw new Error(`gating check was refused: ${gated.reason}`);
  const enqueued = await world.kernel.items.enqueue(caller, {
    harnessId: input.harnessId,
    title: input.title,
    pageId: null,
    priority: 1,
    due: null,
    delegationId: null,
  });
  if (enqueued.status !== 'accepted') throw new Error(`enqueue was refused: ${enqueued.reason}`);
  return enqueued.value.itemId;
}

export async function simParkedAtCheck(world: World, input: ParkInput): Promise<ItemState> {
  const itemId = await enqueuedAtGatedCheck(world, input);
  const parked = await simAdvance(world, {
    harnessId: input.harnessId,
    itemId,
    worker: input.admin,
    through: ['package', 'scope', 'plan', 'build', 'check'],
  });
  if (parked.gateStatus !== 'parked') throw new Error(`the item is ${parked.gateStatus} at check`);
  return parked;
}

export async function simHeldAtCheck(world: World, input: HeldInput): Promise<ItemState> {
  const itemId = await enqueuedAtGatedCheck(world, input);
  const atCheck = await simAdvance(world, {
    harnessId: input.harnessId,
    itemId,
    worker: input.admin,
    through: ['package', 'scope', 'plan', 'build'],
  });
  if (atCheck.stageKey !== 'check') throw new Error(`the item is at ${atCheck.stageKey}`);
  const claimed = await world.kernel.items.claim(simCaller(world, input.agent), {
    itemId,
    delegationId: input.delegationId,
  });
  if (claimed.status !== 'accepted')
    throw new Error(`claiming check was refused: ${claimed.reason}`);
  return claimed.value.item;
}
