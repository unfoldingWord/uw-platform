import assert from 'node:assert/strict';
import type { Identity } from '@uw/contracts';
import { simPerson } from '../fixtures.ts';
import {
  activatePersona,
  failuresIn,
  harnessLog,
  pageStatus,
  personaBody,
  personaFrontmatter,
  personaScene,
  seedPersonaPage,
  type PersonaScene,
} from '../persona-fixtures.ts';
import { defineScenario } from '../scenario.ts';
import type { World } from '../world.ts';

const headless = '00000000-0000-4000-8000-000000008401';
const pageId = '00000000-0000-4000-8000-000000008402';
const identity = 'agent:iterate-two';

async function seedPages(scene: PersonaScene): Promise<void> {
  const served = { requires_tools: ['search_pages'], toolset: ['search_pages'] };
  await seedPersonaPage(scene, {
    id: headless,
    bodyMd: 'Iterate tunes a product from its measurements.',
    frontmatter: personaFrontmatter(scene, served),
  });
  await seedPersonaPage(scene, {
    id: pageId,
    bodyMd: personaBody('iterate-two'),
    frontmatter: personaFrontmatter(scene, { ...served, identity }),
  });
}

async function refusals(scene: PersonaScene): Promise<void> {
  const failed = await activatePersona(scene.world, scene.ian, headless);
  assert.equal(failed.status === 'error' && failed.reason, 'dry_run_failed');
  const failures = failuresIn(await harnessLog(scene.world, scene.bmlId));
  assert.deepEqual(
    failures.map((event) => event.evidence['reason']),
    ['dry_run_failed'],
  );
  assert.equal(await pageStatus(scene.world, headless), 'suggested');
  const editor = await simPerson(scene.world, 5, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '30-39' },
  ]);
  const byEditor = await activatePersona(scene.world, editor, pageId);
  assert.equal(byEditor.status === 'error' && byEditor.reason, 'not_permitted');
  const stale = await activatePersona(scene.world, scene.ian, pageId, 2);
  assert.equal(stale.status === 'error' && stale.reason, 'stale_version');
}

async function projected(world: World, harnessId: string) {
  return world.adapters.store.transaction((tx) =>
    tx.personas.read.active(identity as Identity, harnessId),
  );
}

export const scenario = defineScenario({
  id: 'PE-3',
  title:
    'an admin activates a persona only after the tool check and a dry run: a persona with no agentskills header fails its dry run and stays suggested, an editor and a stale version are refused, and the activation flips the page to active, writes the projection and records one persona_activated',
  run: async (world) => {
    const scene = await personaScene(world);
    await seedPages(scene);
    await refusals(scene);
    const activated = await activatePersona(world, scene.ian, pageId);
    assert.equal(activated.status, 'accepted');
    const page = await projected(world, scene.bmlId);
    assert.equal(page?.id, pageId);
    assert.deepEqual(
      [page.status, page.version, page.frontmatter['status']],
      ['active', 2, 'active'],
    );
    const again = await activatePersona(world, scene.ian, pageId, 2);
    assert.deepEqual(again.status === 'error' && again.detail, { why: 'not_suggested' });
    const log = await harnessLog(world, scene.bmlId);
    const names = log.map((event) => event.name).filter((name) => name.startsWith('persona_'));
    assert.deepEqual(names, ['persona_activation_failed', 'persona_activated']);
    return { state: { events: names, page: { status: page.status, version: page.version } } };
  },
});
