import { principalSchema, type HarnessEvent, type ItemState, type Principal } from '@uw/contracts';
import { seedPage } from '@uw/db/test-seed';
import {
  createKernel,
  readAllEvents,
  software,
  type Caller,
  type KernelOutcome,
  type RunRow,
  type Runs,
  type StartedRun,
  type Template,
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

type Delegated = Pick<RunWorld, 'world' | 'harnessId' | 'admin' | 'owner' | 'delegationId'>;

const signOff: Template = {
  key: 'sign-off',
  title: 'Sign-off',
  stages: [
    {
      key: 'sign_off',
      title: 'Sign-off',
      position: 10,
      bracket: 'build_package',
      agentPickup: 'allowed',
      exitGate: 'human_approval',
      connector: 'none',
      wipLimit: 3,
      validators: [],
      feeds: [],
    },
  ],
};

async function delegated(world: World, template: Template): Promise<Delegated> {
  const { harness, admin } = await createSimHarness(world, template);
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
  return { world, harnessId: harness.id, admin, owner, delegationId: value(granted).id };
}

function withPersona(scene: Delegated, itemId: string): RunWorld {
  return { ...scene, itemId, pageId: defaultPageId, persona: personaPrincipal(scene.owner) };
}

export async function runWorld(world: World): Promise<RunWorld> {
  const scene = await delegated(world, software);
  const itemId = await itemInScope(scene, 'Wire the run host');
  await seedPersona(scene, { id: defaultPageId });
  return withPersona(scene, itemId);
}

export async function gateWorld(world: World): Promise<RunWorld> {
  const scene = await delegated(world, signOff);
  const enqueued = await world.kernel.items.enqueue(simCaller(world, scene.admin), {
    harnessId: scene.harnessId,
    title: 'Sign off the release notes',
    pageId: null,
    priority: 1,
    due: null,
    delegationId: null,
  });
  await seedPersona(scene, { id: defaultPageId });
  return withPersona(scene, value(enqueued).itemId);
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

export type ParkedRun = RunWorld & { readonly runId: string; readonly beat: Caller };

export function stepOn(
  scene: Pick<RunWorld, 'world' | 'itemId'>,
  beat: Caller,
  input: { readonly runId: string; readonly step: 'read' | 'scout' | 'work' | 'submit' },
) {
  return scene.world.kernel.items.recordRunStep(beat, {
    itemId: scene.itemId,
    runId: input.runId,
    step: input.step,
    tokensIn: 100,
    tokensOut: 20,
    costBasis: 'metered',
    costMinor: 3,
  });
}

export async function parkedRun(scene: RunWorld): Promise<ParkedRun> {
  const { runId } = value(await startOn(scene));
  const beat = await beatOf(scene);
  value(await stepOn(scene, beat, { runId, step: 'read' }));
  value(await stepOn(scene, beat, { runId, step: 'submit' }));
  const submitted = await scene.world.kernel.items.submit(beat, {
    itemId: scene.itemId,
    to: null,
    evidence: {},
    change: null,
  });
  if (value(submitted).result !== 'parked') throw new Error('the submit did not park');
  return { ...scene, runId, beat };
}

export type RunsCalls = { readonly resume: string[]; readonly stop: string[] };

export function watchingRuns(
  world: World,
  change: Partial<Runs> = {},
): { readonly world: World; readonly calls: RunsCalls } {
  const calls: RunsCalls = { resume: [], stop: [] };
  const base = world.adapters.runs;
  const runs: Runs = {
    ...base,
    resume: (runId) => {
      calls.resume.push(runId);
      return base.resume(runId);
    },
    stop: (runId) => {
      calls.stop.push(runId);
      return base.stop(runId);
    },
    ...change,
  };
  return { world: { ...world, kernel: createKernel({ ...world.adapters, runs }) }, calls };
}
