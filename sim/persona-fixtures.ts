import type { HarnessEvent, ItemState, PageStatus, PageType, Principal, Role } from '@uw/contracts';
import { seedPage } from '@uw/db/test-seed';
import { bml, readAllEvents, software, type KernelOutcome } from '@uw/harness';
import { createSimHarness, simCaller, simPerson } from './fixtures.ts';
import type { World } from './world.ts';

export type PersonaScene = {
  readonly world: World;
  readonly softwareId: string | null;
  readonly bmlId: string;
  readonly ian: Principal;
  readonly owner: Principal;
};

export type PersonaPage = {
  readonly id: string;
  readonly type?: PageType;
  readonly status?: PageStatus;
  readonly jdArea?: string;
  readonly frontmatter?: Readonly<Record<string, unknown>>;
};

export type SceneOptions = { readonly ownerRole?: Role; readonly software?: boolean };

export async function personaScene(
  world: World,
  options: SceneOptions = {},
): Promise<PersonaScene> {
  const softwareHarness =
    options.software === false ? null : await createSimHarness(world, software);
  const bmlHarness = await createSimHarness(world, bml, { jdArea: '30-39' });
  const owner = await simPerson(world, 2, [
    { role: options.ownerRole ?? 'editor', scopeKind: 'jd_area', scopeArea: '30-39' },
  ]);
  return {
    world,
    softwareId: softwareHarness?.harness.id ?? null,
    bmlId: bmlHarness.harness.id,
    ian: bmlHarness.admin,
    owner,
  };
}

export function personaFrontmatter(
  scene: PersonaScene,
  change: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    identity: 'agent:iterate',
    owner: scene.owner.identity,
    harness: scene.bmlId,
    toolset: ['search_pages'],
    run_shape: 'workflow-run',
    engine: 'openrouter-messages',
    model: 'glm-5.3-flash',
    budget: { monthly_minor: 0, currency: 'USD' },
    capability: 'iterate',
    requires_tools: ['search_pages', 'summarise_measurements'],
    ...change,
  };
}

export async function seedPersonaPage(scene: PersonaScene, page: PersonaPage): Promise<void> {
  await seedPage(scene.world.database.db, {
    id: page.id,
    type: page.type ?? 'persona',
    status: page.status ?? 'suggested',
    jdArea: page.jdArea ?? '30-39',
    slug: `persona-${page.id.slice(-4)}`,
    title: 'Iterate',
    bodyMd: 'Iterate tunes a product from its measurements.',
    frontmatter: page.frontmatter ?? personaFrontmatter(scene),
  });
}

export function activatePersona(
  world: World,
  actor: Principal,
  pageId: string,
  expectedVersion = 1,
): Promise<KernelOutcome<never>> {
  return world.kernel.personas.activate(simCaller(world, actor), { pageId, expectedVersion });
}

export function harnessLog(world: World, harnessId: string): Promise<readonly HarnessEvent[]> {
  return world.adapters.store.transaction((tx) => readAllEvents(tx, harnessId, null));
}

export async function harnessItems(
  world: World,
  harnessId: string | null,
): Promise<readonly ItemState[]> {
  if (harnessId === null) return [];
  return world.adapters.store.transaction((tx) => tx.harnessItems.read.forHarness(harnessId));
}

export async function pageStatus(world: World, pageId: string): Promise<PageStatus | null> {
  const [facts] = await world.adapters.store.transaction((tx) => tx.pages.read.facts([pageId]));
  return facts?.status ?? null;
}

export function failuresIn(events: readonly HarnessEvent[]): readonly HarnessEvent[] {
  return events.filter((event) => event.name === 'persona_activation_failed');
}
