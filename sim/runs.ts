import { principalSchema, type HarnessEvent, type ItemState, type Principal } from '@uw/contracts';
import { seedPage } from '@uw/db/test-seed';
import {
  readAllEvents,
  software,
  type Caller,
  type KernelOutcome,
  type RunRow,
  type StartedRun,
} from '@uw/harness';
import { createSimHarness, simAdvance, simCaller, simPerson, simSystem } from './fixtures.ts';
import type { World } from './world.ts';

export type RunWorld = {
  readonly world: World;
  readonly harnessId: string;
  readonly itemId: string;
  readonly admin: Principal;
  readonly owner: Principal;
  readonly delegationId: string;
  readonly pageId: string;
  readonly persona: Principal;
};

export type PageChange = {
  readonly id: string;
  readonly status?: 'active' | 'suggested';
  readonly frontmatter?: Readonly<Record<string, unknown>>;
};

const personaIdentity = 'agent:builder';
const defaultPageId = '00000000-0000-4000-8000-000000009501';

export function value<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

export function reasonOf(outcome: KernelOutcome<unknown>): string | null {
  return outcome.status === 'error' ? outcome.reason : null;
}

export function detailOf(outcome: KernelOutcome<unknown>): unknown {
  return outcome.status === 'error' ? outcome.detail : null;
}

export function builderFrontmatter(
  scene: Pick<RunWorld, 'harnessId' | 'owner'>,
  change: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    identity: personaIdentity,
    owner: scene.owner.identity,
    harness: scene.harnessId,
    toolset: ['read_page', 'record_run_step', 'submit_to_gate'],
    run_shape: 'workflow-run',
    engine: 'claude-messages',
    model: 'claude-sonnet-5',
    provider: null,
    budget: { monthly_minor: 0, currency: 'USD' },
    capability: 'build',
    requires_tools: [],
    ...change,
  };
}

export async function seedPersona(
  scene: Pick<RunWorld, 'world' | 'harnessId' | 'owner'>,
  page: PageChange,
): Promise<void> {
  await seedPage(scene.world.database.db, {
    id: page.id,
    type: 'persona',
    status: page.status ?? 'active',
    jdArea: '80-89',
    slug: `builder-${page.id.slice(-4)}`,
    title: 'Builder',
    bodyMd: 'Builder turns an approved plan into commits.',
    frontmatter: page.frontmatter ?? builderFrontmatter(scene),
  });
}

export async function itemInScope(
  scene: Pick<RunWorld, 'world' | 'harnessId' | 'admin'>,
  title: string,
): Promise<string> {
  const { world, harnessId, admin } = scene;
  const enqueued = await world.kernel.items.enqueue(simCaller(world, admin), {
    harnessId,
    title,
    pageId: null,
    priority: 1,
    due: null,
    delegationId: null,
  });
  const { itemId } = value(enqueued);
  await simAdvance(world, { harnessId, itemId, worker: admin, through: ['package'] });
  return itemId;
}

function personaPrincipal(owner: Principal): Principal {
  return principalSchema.parse({
    identity: personaIdentity,
    kind: 'agent',
    personId: owner.personId,
    email: null,
    grants: [],
    interactive: false,
  });
}

export async function runWorld(world: World): Promise<RunWorld> {
  const { harness, admin } = await createSimHarness(world, software);
  const owner = await simPerson(world, 4, [
    { role: 'admin', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const granted = await world.kernel.delegations.grant(simCaller(world, owner), {
    harnessId: harness.id,
    persona: personaIdentity,
    capability: 'build',
    expiresAt: null,
    supersedes: null,
  });
  const scene = { world, harnessId: harness.id, admin, owner };
  const itemId = await itemInScope(scene, 'Wire the run host');
  await seedPersona(scene, { id: defaultPageId });
  return {
    ...scene,
    itemId,
    delegationId: value(granted).id,
    pageId: defaultPageId,
    persona: personaPrincipal(owner),
  };
}

export function personaCaller(scene: RunWorld): Caller {
  return simCaller(scene.world, scene.persona);
}

export function systemCaller(scene: RunWorld): Caller {
  return simCaller(scene.world, simSystem());
}

export function startOn(
  scene: RunWorld,
  change: { readonly itemId?: string; readonly pageId?: string } = {},
): Promise<KernelOutcome<StartedRun>> {
  return scene.world.kernel.runs.start(personaCaller(scene), {
    itemId: change.itemId ?? scene.itemId,
    delegationId: scene.delegationId,
    personaPageId: change.pageId ?? scene.pageId,
  });
}

export async function beatOf(scene: RunWorld): Promise<Caller> {
  const beat = await scene.world.kernel.delegations.beat(personaCaller(scene), {
    delegationId: scene.delegationId,
  });
  return simCaller(scene.world, value(beat).principal);
}

export function runOf(world: World, runId: string): Promise<RunRow | null> {
  return world.adapters.store.transaction((tx) => tx.harnessRuns.read.byId(runId));
}

export function itemOf(world: World, itemId: string): Promise<ItemState | null> {
  return world.adapters.store.transaction((tx) => tx.harnessItems.read.byId(itemId));
}

export async function itemEvents(
  scene: Pick<RunWorld, 'world' | 'harnessId'>,
  itemId: string,
): Promise<readonly HarnessEvent[]> {
  return scene.world.adapters.store.transaction((tx) => readAllEvents(tx, scene.harnessId, itemId));
}

export async function harnessNames(scene: RunWorld): Promise<readonly string[]> {
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, null),
  );
  return events.filter((event) => event.itemId === null).map((event) => event.name);
}
