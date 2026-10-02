import { verbRegistry, type Principal, type VerbDefinition } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { createPersonaCommands, type KernelOutcome } from '@uw/harness';
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
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const pageId = '00000000-0000-4000-8000-000000008301';
const forbidden = 'persona iterate names approve, which no agent may hold';
const unreachable =
  "persona iterate requires verb list_gifts, which the activating person's grants do not reach";

type Seen = {
  readonly outcome: KernelOutcome<never>;
  readonly failures: readonly unknown[];
  readonly items: number;
  readonly status: string | null;
};

type Activate = (scene: PersonaScene) => Promise<KernelOutcome<never>>;

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
    return { outcome, failures, items, status: await pageStatus(world, pageId) };
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
  const personas = createPersonaCommands(scene.world.adapters, servedListGifts());
  return personas.activate(simCaller(scene.world, kim), { pageId, expectedVersion: 1 });
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
    expect(seen.outcome).toEqual({
      status: 'error',
      reason: 'not_wired',
      detail: { step: 'PE-3' },
    });
    expect(seen.failures).toEqual([]);
  });
});

describe('persona activation refuses a caller who may not activate, and stops short of PE-3 when every verb passes', () => {
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

  it('answers an all-served toolset not_wired until PE-3, with no event and the page still suggested', async () => {
    const seen = await inScene(requiring(['search_pages', 'read_page']), byIan);
    expect(seen.outcome).toEqual({
      status: 'error',
      reason: 'not_wired',
      detail: { step: 'PE-3' },
    });
    expect([seen.failures, seen.items, seen.status]).toEqual([[], 0, 'suggested']);
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
