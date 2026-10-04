import { verbRegistry, type Identity, type Principal, type VerbDefinition } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { resaveSeededPage } from '@uw/db/test-seed';
import type { ActivatedPersona, KernelOutcome } from '@uw/harness';
import { createPersonaActivation } from '@uw/harness/persona-activation';
import { afterAll, describe, expect, it } from 'vitest';
import { simAgent, simCaller, simPerson } from '../fixtures.ts';
import {
  activatePersona,
  failuresIn,
  harnessItems,
  harnessLog,
  pageStatus,
  personaFrontmatter,
  personaScene,
  seedPersonaPage,
  type PersonaPage,
  type PersonaScene,
  type SceneOptions,
} from '../persona-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const pageId = '00000000-0000-4000-8000-000000008301';
const forbidden = 'persona iterate names approve, which no agent may hold';
const unreachable =
  "persona iterate requires verb list_gifts, which the activating person's grants do not reach";

type Seen = {
  readonly outcome: KernelOutcome<ActivatedPersona>;
  readonly failures: readonly unknown[];
  readonly items: number;
  readonly created: number;
  readonly status: string | null;
};

type Activate = (scene: PersonaScene) => Promise<KernelOutcome<ActivatedPersona>>;

async function createdIn(world: World, harnessIds: readonly (string | null)[]): Promise<number> {
  let created = 0;
  for (const harnessId of harnessIds) {
    if (harnessId === null) continue;
    const log = await harnessLog(world, harnessId);
    created += log.filter((event) => event.name === 'item_created').length;
  }
  return created;
}

async function inScene(
  page: (scene: PersonaScene) => Omit<PersonaPage, 'id'>,
  activate: Activate,
  options: SceneOptions = {},
): Promise<Seen> {
  const world = await createWorld();
  try {
    const scene = await personaScene(world, options);
    await seedPersonaPage(scene, { id: pageId, ...page(scene) });
    const outcome = await activate(scene);
    const failures = failuresIn(await harnessLog(world, scene.bmlId)).map(
      (event) => event.evidence,
    );
    const items = (await harnessItems(world, scene.softwareId)).length;
    const created = await createdIn(world, [scene.bmlId, scene.softwareId]);
    return { outcome, failures, items, created, status: await pageStatus(world, pageId) };
  } finally {
    await world.close();
  }
}

function requiring(tools: readonly string[], toolset: readonly string[] = ['search_pages']) {
  return (scene: PersonaScene) => ({
    frontmatter: personaFrontmatter(scene, { requires_tools: tools, toolset }),
  });
}

const byIan: Activate = (scene) => activatePersona(scene.world, scene.ian, pageId);

function byPerson(grants: Parameters<typeof simPerson>[2]): Activate {
  return async (scene) =>
    activatePersona(scene.world, await simPerson(scene.world, 5, grants), pageId);
}

const admin3039 = [{ role: 'admin', scopeKind: 'jd_area', scopeArea: '30-39' }] as const;

function servedListGifts(): readonly VerbDefinition[] {
  return verbRegistry.map((entry) =>
    entry.name === 'list_gifts' ? { ...entry, servedInV1: true } : entry,
  );
}

const withFixtureRegistry: Activate = async (scene) => {
  const kim: Principal = await simPerson(scene.world, 5, admin3039);
  const personas = createPersonaActivation(scene.world.adapters, servedListGifts());
  const input = { pageId, expectedVersion: 1, harnessId: scene.bmlId };
  return personas.activate(simCaller(scene.world, kim), input);
};

describe('AB-8 activation refuses a forbidden verb and an unreachable verb', () => {
  it('refuses a forbidden verb with its own message and an event, and opens no item', async () => {
    const seen = await inScene(requiring(['approve']), byIan);
    expect(seen.outcome).toEqual({
      status: 'error',
      reason: 'forbidden_verb',
      detail: { verb: 'approve', message: forbidden, itemId: null },
    });
    expect(seen.failures).toEqual([
      {
        pageId,
        persona: 'agent:iterate',
        verb: 'approve',
        engine: null,
        reason: 'forbidden_verb',
        message: forbidden,
        itemId: null,
      },
    ]);
    expect([seen.items, seen.status]).toEqual([0, 'suggested']);
  });

  it("refuses a verb the activating person's grants do not reach, with an event and no item", async () => {
    const seen = await inScene(requiring(['list_gifts']), withFixtureRegistry);
    expect(seen.outcome).toEqual({
      status: 'error',
      reason: 'not_permitted',
      detail: { verb: 'list_gifts', message: unreachable, itemId: null },
    });
    expect(seen.failures).toEqual([
      expect.objectContaining({ verb: 'list_gifts', reason: 'not_permitted', itemId: null }),
    ]);
    expect(seen.items).toBe(0);
  });

  it("judges reach by the activating person's grants, not the owner the frontmatter names", async () => {
    const seen = await inScene(requiring(['claim_item'], ['claim_item']), byIan, {
      ownerRole: 'viewer',
    });
    expect(seen.outcome).toMatchObject({ status: 'accepted' });
    expect(seen.failures).toEqual([]);
  });
});

describe('HE-10 activation refuses a persona on the reserved engine', () => {
  it('HE-10 activating a persona on claude-managed-agent is refused engine_not_available and opens no item', async () => {
    const message = 'persona iterate uses engine claude-managed-agent, which is not available';
    const page = (scene: PersonaScene) => ({
      frontmatter: personaFrontmatter(scene, {
        engine: 'claude-managed-agent',
        requires_tools: ['summarise_measurements'],
      }),
    });
    const seen = await inScene(page, byIan);
    expect(seen.outcome).toEqual({
      status: 'error',
      reason: 'engine_not_available',
      detail: { engine: 'claude-managed-agent' },
    });
    expect(seen.failures).toEqual([
      {
        pageId,
        persona: 'agent:iterate',
        verb: null,
        engine: 'claude-managed-agent',
        reason: 'engine_not_available',
        message,
        itemId: null,
      },
    ]);
    expect([seen.items, seen.created, seen.status]).toEqual([0, 0, 'suggested']);
  });
});

describe('persona activation refuses a caller who may not activate', () => {
  it('refuses an editor who is not an admin of the harness area, with no event', async () => {
    const editor = byPerson([{ role: 'editor', scopeKind: 'jd_area', scopeArea: '30-39' }]);
    const seen = await inScene(requiring(['approve']), editor);
    expect(seen.outcome).toEqual({
      status: 'error',
      reason: 'not_permitted',
      detail: { jdArea: '30-39' },
    });
    expect(seen.failures).toEqual([]);
  });

  it("refuses an admin of the harness area who cannot write the persona page's area, with no event", async () => {
    const page = (scene: PersonaScene) => ({ ...requiring(['approve'])(scene), jdArea: '20-29' });
    const seen = await inScene(page, byPerson(admin3039));
    expect(seen.outcome).toEqual({
      status: 'error',
      reason: 'not_permitted',
      detail: { jdArea: '20-29' },
    });
    expect(seen.failures).toEqual([]);
  });

  it('refuses an agent caller, with no event', async () => {
    const agent: Activate = (scene) =>
      activatePersona(scene.world, simAgent(scene.ian, 'iterate', { interactive: true }), pageId);
    const seen = await inScene(requiring(['approve']), agent);
    expect(seen.outcome).toEqual({
      status: 'error',
      reason: 'not_permitted',
      detail: { actor: 'agent:iterate' },
    });
    expect(seen.failures).toEqual([]);
  });

  it('answers a page that is not a persona page_not_found', async () => {
    const seen = await inScene(
      (scene) => ({ ...requiring(['approve'])(scene), type: 'product' }),
      byIan,
    );
    expect(seen.outcome).toEqual({ status: 'error', reason: 'page_not_found', detail: { pageId } });
  });
});

describe('persona activation refuses a page it cannot activate before running the tool check', () => {
  it('answers a page that does not exist page_not_found', async () => {
    const missing: Activate = (scene) =>
      activatePersona(scene.world, scene.ian, '00000000-0000-4000-8000-000000008399');
    const seen = await inScene(requiring(['approve']), missing);
    expect(seen.outcome).toMatchObject({ status: 'error', reason: 'page_not_found' });
  });

  it('answers frontmatter that is not a persona invalid_frontmatter', async () => {
    const page = (scene: PersonaScene) => ({
      frontmatter: personaFrontmatter(scene, { owner: 7 }),
    });
    const seen = await inScene(page, byIan);
    expect(seen.outcome).toEqual({
      status: 'error',
      reason: 'invalid_frontmatter',
      detail: { pageId },
    });
  });

  it('answers a persona whose harness does not exist harness_not_found', async () => {
    const harness = '00000000-0000-4000-8000-000000008398';
    const page = (scene: PersonaScene) => ({ frontmatter: personaFrontmatter(scene, { harness }) });
    const seen = await inScene(page, byIan);
    expect(seen.outcome).toEqual({
      status: 'error',
      reason: 'harness_not_found',
      detail: { harnessId: harness },
    });
  });

  it('refuses a persona that is not suggested, with no event', async () => {
    const page = (scene: PersonaScene) => ({
      ...requiring(['approve'])(scene),
      status: 'active' as const,
    });
    const seen = await inScene(page, byIan);
    expect(seen.outcome).toEqual({
      status: 'error',
      reason: 'not_permitted',
      detail: { why: 'not_suggested' },
    });
    expect([seen.failures, seen.status]).toEqual([[], 'active']);
  });

  it('records a missing verb with no item when there is no software harness', async () => {
    const seen = await inScene(requiring(['summarise_measurements']), byIan, { software: false });
    expect(seen.outcome).toMatchObject({
      reason: 'unknown_verb',
      detail: { itemId: null, why: 'software_harness_missing' },
    });
    expect(seen.failures).toEqual([expect.objectContaining({ itemId: null })]);
  });
});

describe('persona activation hides a page from a person who cannot read its area', () => {
  it.each([
    ['frontmatter that is not a persona', { owner: 7 }],
    ['a harness that does not exist', { harness: '00000000-0000-4000-8000-000000008398' }],
  ])(
    'answers a person who cannot read the page area page_not_found for %s',
    async (_case, change) => {
      const page = (scene: PersonaScene) => ({ frontmatter: personaFrontmatter(scene, change) });
      const outsider = byPerson([{ role: 'viewer', scopeKind: 'jd_area', scopeArea: '80-89' }]);
      const seen = await inScene(page, outsider);
      expect(seen.outcome).toEqual({
        status: 'error',
        reason: 'page_not_found',
        detail: { pageId },
      });
    },
  );
});

describe('persona activation acts on the page version the person read', () => {
  it('refuses a version that is no longer the stored one stale_version, with no event or item', async () => {
    const stale: Activate = (scene) => activatePersona(scene.world, scene.ian, pageId, 2);
    const seen = await inScene(requiring(['summarise_measurements']), stale);
    expect(seen.outcome).toEqual({
      status: 'error',
      reason: 'stale_version',
      detail: { pageId, version: 1 },
    });
    expect([seen.failures, seen.items, seen.status]).toEqual([[], 0, 'suggested']);
  });
});

const secondPage = '00000000-0000-4000-8000-000000008302';

async function withScene(work: (scene: PersonaScene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await personaScene(world));
  } finally {
    await world.close();
  }
}

function projected(scene: PersonaScene, identity = 'agent:iterate') {
  return scene.world.adapters.store.transaction(async (tx) => {
    const page = await tx.personas.read.active(identity as Identity, scene.bmlId);
    return page === null ? null : { id: page.id, status: page.frontmatter['status'] };
  });
}

async function namesIn(scene: PersonaScene): Promise<readonly string[]> {
  return (await harnessLog(scene.world, scene.bmlId)).map((event) => event.name);
}

async function seedServed(
  scene: PersonaScene,
  id = pageId,
  slug = `persona-${id.slice(-4)}`,
): Promise<void> {
  await seedPersonaPage(scene, { id, slug, ...requiring(['search_pages'])(scene) });
}

async function activatesAndProjects(scene: PersonaScene): Promise<void> {
  await seedServed(scene);
  const before = await namesIn(scene);
  const outcome = await activatePersona(scene.world, scene.ian, pageId);
  expect(outcome).toEqual({
    status: 'accepted',
    value: { pageId, persona: 'agent:iterate', harnessId: scene.bmlId, version: 2 },
  });
  expect(await pageStatus(scene.world, pageId)).toBe('active');
  expect(await projected(scene)).toEqual({ id: pageId, status: 'active' });
  const log = await harnessLog(scene.world, scene.bmlId);
  expect(log.map((event) => event.name).slice(before.length)).toEqual(['persona_activated']);
  expect(log.at(-1)?.evidence).toEqual({ pageId, persona: 'agent:iterate', version: 2 });
}

async function frontmatterReadsActive(scene: PersonaScene): Promise<void> {
  await seedServed(scene);
  await activatePersona(scene.world, scene.ian, pageId);
  const [facts] = await scene.world.adapters.store.transaction((tx) =>
    tx.pages.read.facts([pageId]),
  );
  expect([facts?.status, facts?.version, facts?.frontmatter['status']]).toEqual([
    'active',
    2,
    'active',
  ]);
}

async function dryRunFailureRecorded(scene: PersonaScene): Promise<void> {
  await seedPersonaPage(scene, {
    id: pageId,
    bodyMd: 'Iterate tunes a product from its measurements.',
    ...requiring(['search_pages'])(scene),
  });
  const message =
    'persona iterate instructions are not an agentskills document: no agentskills header';
  expect(await activatePersona(scene.world, scene.ian, pageId)).toEqual({
    status: 'error',
    reason: 'dry_run_failed',
    detail: { message },
  });
  expect(failuresIn(await harnessLog(scene.world, scene.bmlId)).map((e) => e.evidence)).toEqual([
    {
      pageId,
      persona: 'agent:iterate',
      verb: null,
      engine: null,
      reason: 'dry_run_failed',
      message,
      itemId: null,
    },
  ]);
  expect([await pageStatus(scene.world, pageId), await projected(scene)]).toEqual([
    'suggested',
    null,
  ]);
}

async function editorAndAgentRefused(scene: PersonaScene): Promise<void> {
  await seedServed(scene);
  const before = await namesIn(scene);
  const editor = await simPerson(scene.world, 5, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '30-39' },
  ]);
  const agent = simAgent(scene.ian, 'iterate', { interactive: true });
  for (const actor of [editor, agent]) {
    expect(await activatePersona(scene.world, actor, pageId)).toMatchObject({
      status: 'error',
      reason: 'not_permitted',
    });
  }
  expect(await namesIn(scene)).toEqual(before);
  expect([await pageStatus(scene.world, pageId), await projected(scene)]).toEqual([
    'suggested',
    null,
  ]);
}

async function staleVersionRecordsNothing(scene: PersonaScene): Promise<void> {
  await seedServed(scene);
  await resaveSeededPage(scene.world.database.db, pageId);
  const before = await namesIn(scene);
  expect(await activatePersona(scene.world, scene.ian, pageId, 1)).toEqual({
    status: 'error',
    reason: 'stale_version',
    detail: { pageId, version: 2 },
  });
  expect(await namesIn(scene)).toEqual(before);
  expect([await pageStatus(scene.world, pageId), await projected(scene)]).toEqual([
    'suggested',
    null,
  ]);
}

async function identityInUseRefused(scene: PersonaScene): Promise<void> {
  await seedServed(scene);
  await seedServed(scene, secondPage, 'persona-iterate-again');
  expect((await activatePersona(scene.world, scene.ian, pageId)).status).toBe('accepted');
  const before = await namesIn(scene);
  expect(await activatePersona(scene.world, scene.ian, secondPage)).toEqual({
    status: 'error',
    reason: 'not_permitted',
    detail: { why: 'identity_in_use' },
  });
  expect(await namesIn(scene)).toEqual(before);
  expect(await pageStatus(scene.world, secondPage)).toBe('suggested');
  expect(await projected(scene)).toEqual({ id: pageId, status: 'active' });
}

describe('PE-3 an admin activates a persona after the tool check and a dry run', () => {
  it('PE-3 activation runs the tool check and a dry run, then flips the persona to active and writes the projection', () =>
    withScene(activatesAndProjects));

  it("PE-1 an activated persona's frontmatter reads status active", () =>
    withScene(frontmatterReadsActive));

  it('PE-3 a dry run failure records persona_activation_failed and leaves the persona suggested', () =>
    withScene(dryRunFailureRecorded));

  it('PE-3 an editor and an agent cannot activate', () => withScene(editorAndAgentRefused));

  it('PE-3 activation at a stale version is refused and records nothing', () =>
    withScene(staleVersionRecordsNothing));

  it('PE-3 a persona whose identity another active page holds is refused identity_in_use', () =>
    withScene(identityInUseRefused));

  it('PE-2 activation checks the derived requires_tools: a missing verb opens one item and leaves the persona suggested', async () => {
    const tools = ['search_pages', 'summarise_measurements'];
    const seen = await inScene(requiring(tools, tools), byIan);
    expect(seen.outcome).toMatchObject({
      status: 'error',
      reason: 'unknown_verb',
      detail: { verb: 'summarise_measurements' },
    });
    expect([seen.items, seen.status]).toEqual([1, 'suggested']);
  });
});
