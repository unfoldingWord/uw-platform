import assert from 'node:assert/strict';
import { personaSlugOf, type HarnessEvent, type Identity } from '@uw/contracts';
import { seedPage } from '@uw/db/test-seed';
import { personaPageDraft, readAllEvents, software, templatePersonas } from '@uw/harness';
import { createPersonaActivation } from '@uw/harness/persona-activation';
import {
  createSimHarness,
  readSpend,
  simCaller,
  simDelegate,
  simPerson,
  simSystem,
} from '../fixtures.ts';
import { itemInScope, itemOf, value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import type { World } from '../world.ts';

const pageIds: ReadonlyMap<string, string> = new Map([
  ['builder', '00000000-0000-4000-8000-000000009401'],
  ['builder-hosted', '00000000-0000-4000-8000-000000009402'],
  ['reviewer', '00000000-0000-4000-8000-000000009403'],
  ['reviewer-codex', '00000000-0000-4000-8000-000000009404'],
]);

type Drafted = { readonly id: string; readonly jdArea: string };

async function draftPersonas(world: World, harness: Drafted, owner: Identity): Promise<void> {
  for (const fixture of templatePersonas.software) {
    const draft = personaPageDraft(fixture, harness, owner);
    await seedPage(world.database.db, {
      id: pageIds.get(fixture.slug) ?? '',
      type: 'persona',
      status: 'suggested',
      jdArea: harness.jdArea,
      slug: draft.slug,
      title: draft.title,
      bodyMd: draft.bodyMd,
      frontmatter: {
        ...draft.frontmatter,
        requires_tools: [...fixture.toolset],
        status: 'suggested',
      },
    });
  }
}

function heldPerPersona(events: readonly HarnessEvent[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const event of events.filter((entry) => entry.name === 'premise_held')) {
    const slug = personaSlugOf(event.actor) ?? event.actor;
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  return counts;
}

export const scenario = defineScenario({
  id: 'PE-5',
  title:
    'Builder is a persona page drafted from the software template: an admin activates the hosted Builder, the beat starts it on an item in scope, and the premise it holds leaves the item free and is counted for that persona alone',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    await readSpend(world);
    const ian = simCaller(world, admin);
    await draftPersonas(world, harness, admin.identity);
    const pageId = pageIds.get('builder-hosted') ?? '';
    const input = { pageId, expectedVersion: 1, harnessId: harness.id };
    value(await createPersonaActivation(world.adapters).activate(ian, input));
    value(
      await world.kernel.stages.setHostedBuilder(ian, { harnessId: harness.id, enabled: true }),
    );
    const owner = await simPerson(world, 4, [
      { role: 'admin', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    const delegation = {
      harnessId: harness.id,
      persona: 'agent:builder-hosted',
      capability: 'build' as const,
      expiresAt: null,
      supersedes: null,
    };
    value(await simDelegate(world, owner, delegation));
    const itemId = await itemInScope({ world, harnessId: harness.id, admin }, 'Wire the board');
    const host = simCaller(world, simSystem());
    const [started] = value(await world.kernel.runs.beat(host, { limit: 10 })).started;
    assert.equal(started?.persona, 'agent:builder-hosted');
    const reason = 'the premise names a file that no longer exists';
    value(await world.kernel.runs.holdPremise(host, started?.runId ?? '', { reason }));
    const item = await itemOf(world, itemId);
    assert.deepEqual([item?.stageKey, item?.holder], ['scope', null]);
    const events = await world.adapters.store.transaction((tx) =>
      readAllEvents(tx, harness.id, null),
    );
    const held = events.filter((event) => event.name === 'premise_held');
    assert.deepEqual(
      held.map((event) => event.actor),
      ['agent:builder-hosted'],
    );
    const counts = heldPerPersona(events);
    assert.deepEqual([counts.get('builder-hosted') ?? 0, counts.get('builder') ?? 0], [1, 0]);
    return { state: { item, premisesHeld: Object.fromEntries(counts) } };
  },
});
