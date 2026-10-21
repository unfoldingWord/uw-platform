import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { simCaller } from '../fixtures.ts';
import { fixerPage, fixWorld, roundText } from '../fix-claims.ts';
import { personaPrincipal, reasonOf, value } from '../runs.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function readsRoundFindings(world: World): Promise<void> {
  const scene = await fixWorld(world);
  const persona = personaPrincipal(scene.owner, 'agent:builder');
  const started = await world.kernel.runs.start(simCaller(world, persona), {
    itemId: scene.itemId,
    delegationId: scene.fixId,
    personaPageId: fixerPage,
  });
  const { runId } = value(started);
  expect(value(await world.kernel.runs.reviewComments(scene.host, runId))).toEqual({
    comments: [`real: ${roundText}`],
  });
  expect(reasonOf(await world.kernel.runs.reviewComments(scene.host, scene.runId))).toBe(
    'not_permitted',
  );
  expect(reasonOf(await world.kernel.runs.reviewComments(simCaller(world, persona), runId))).toBe(
    'not_permitted',
  );
}

describe('FL-4 the fix run reads the findings of the round that opened it', () => {
  it('FL-4 the host reads real and plausible findings with their weight, for a fix run only', async () => {
    const world = await createWorld();
    try {
      await readsRoundFindings(world);
    } finally {
      await world.close();
    }
  });
});
