import type { HarnessEvent, ItemState } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { rewritePageFrontmatter } from '@uw/db/test-seed';
import { afterAll, describe, expect, it } from 'vitest';
import {
  activatePersona,
  failuresIn,
  harnessItems,
  harnessLog,
  personaFrontmatter,
  personaScene,
  seedPersonaPage,
  type PersonaScene,
} from '../persona-fixtures.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const pageId = '00000000-0000-4000-8000-000000008501';

type Attempts = {
  readonly reasons: readonly string[];
  readonly failures: readonly HarnessEvent[];
  readonly items: readonly ItemState[];
};

type Between = (scene: PersonaScene) => Promise<void>;

async function attempts(first: readonly string[], between: readonly Between[]): Promise<Attempts> {
  const world = await createWorld();
  try {
    const scene = await personaScene(world);
    const frontmatter = personaFrontmatter(scene, { requires_tools: first });
    await seedPersonaPage(scene, { id: pageId, frontmatter });
    const reasons: string[] = [];
    for (const step of [async () => undefined, ...between]) {
      await step(scene);
      const outcome = await activatePersona(world, scene.ian, pageId);
      reasons.push(outcome.status === 'error' ? outcome.reason : outcome.status);
    }
    const failures = failuresIn(await harnessLog(world, scene.bmlId));
    return { reasons, failures, items: await harnessItems(world, scene.softwareId) };
  } finally {
    await world.close();
  }
}

function requiring(tools: readonly string[]): Between {
  return (scene) =>
    rewritePageFrontmatter(
      scene.world.database.db,
      pageId,
      personaFrontmatter(scene, { requires_tools: tools }),
    );
}

const finishItems: Between = (scene) =>
  scene.world.adapters.store.transaction(async (tx) => {
    const softwareId = scene.softwareId ?? '';
    for (const item of await tx.harnessItems.read.forHarness(softwareId)) {
      await tx.harnessItems.write.project({ ...item, gateStatus: 'done' });
    }
  });

function itemIdsOf(failures: readonly HarnessEvent[]): readonly unknown[] {
  return failures.map((event) => event.evidence.itemId);
}

const missing = (verb: string) => `persona iterate requires verb ${verb}, which does not exist`;

function renamed(identity: string): Between {
  return (scene) =>
    rewritePageFrontmatter(
      scene.world.database.db,
      pageId,
      personaFrontmatter(scene, { identity, requires_tools: ['summarise_measurements'] }),
    );
}

describe('AB-8 a missing verb opens one item per persona page and verb', () => {
  it('keeps one item when the persona is renamed between attempts', async () => {
    const seen = await attempts(['summarise_measurements'], [renamed('agent:tuner')]);
    expect(seen.reasons).toEqual(['unknown_verb', 'unknown_verb']);
    expect(seen.items).toHaveLength(1);
    expect(itemIdsOf(seen.failures)).toEqual([seen.items[0]?.itemId, seen.items[0]?.itemId]);
  });

  it('opens a second item when the persona later needs a different missing verb', async () => {
    const seen = await attempts(['summarise_measurements'], [requiring(['measure_reach'])]);
    expect(seen.reasons).toEqual(['unknown_verb', 'unknown_verb']);
    expect(seen.items.map((item) => item.title)).toEqual([
      missing('summarise_measurements'),
      missing('measure_reach'),
    ]);
    expect(itemIdsOf(seen.failures)).toEqual(seen.items.map((item) => item.itemId));
  });

  it('opens a new item once the item for the same verb is done', async () => {
    const seen = await attempts(['summarise_measurements'], [finishItems]);
    expect(seen.items).toHaveLength(2);
    expect(new Set(itemIdsOf(seen.failures)).size).toBe(2);
    expect(seen.items.map((item) => item.gateStatus).sort()).toEqual(['done', 'working']);
  });

  it('records a 300-character missing verb as an event and one item, never an internal error', async () => {
    const seen = await attempts(['a'.repeat(300)], []);
    expect(seen.reasons).toEqual(['unknown_verb']);
    expect(seen.failures.map((event) => event.evidence)).toEqual([
      expect.objectContaining({ verb: 'a'.repeat(64), message: missing('a'.repeat(64)) }),
    ]);
    expect(seen.items.map((item) => item.title)).toEqual([missing('a'.repeat(64))]);
  });
});
