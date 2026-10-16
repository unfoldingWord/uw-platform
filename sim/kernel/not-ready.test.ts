import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simIngest, simPerson } from '../fixtures.ts';
import { reasonOf, value } from '../runs.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const DAY_MS = 86_400_000;
const issue = { repo: 'unfoldingWord/uw-platform', number: 12, githubId: 9100000012 };

async function inWorld(work: (world: World) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(world);
  } finally {
    await world.close();
  }
}

async function missing(world: World, harnessId: string) {
  const events = await world.adapters.store.transaction((tx) => readAllEvents(tx, harnessId, null));
  return events.filter((event) => event.name === 'done_when_missing');
}

async function missingEvidence(world: World, harnessId: string) {
  const recorded = await missing(world, harnessId);
  return recorded.map((event) => ({ itemId: event.itemId, evidence: event.evidence }));
}

function importWithout(world: World, harnessId: string, doneWhen: readonly string[] = []) {
  return world.kernel.items.importIssue(simCaller(world, simIngest()), {
    harnessId,
    issue,
    title: 'Wire the board',
    pageId: null,
    doneWhen,
  });
}

async function kickstartNotReady(world: World): Promise<void> {
  const { harness } = await createSimHarness(world, software);
  const editor = await simPerson(world, 2, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const pageId = '00000000-0000-4000-8000-000000003101';
  const input = {
    harnessId: harness.id,
    via: 'kickstart' as const,
    issue: null,
    pageId,
    title: 'Show the board',
  };
  const byEditor = await world.kernel.items.recordNotReady(simCaller(world, editor), input);
  expect(reasonOf(byEditor)).toBe('done_when_missing');
  const agent = simAgent(editor, `${editor.personId}/builder`, { interactive: true });
  const byAgent = await world.kernel.items.recordNotReady(simCaller(world, agent), input);
  expect(reasonOf(byAgent)).toBe('not_permitted');
  const both = { ...input, issue };
  const malformed = await world.kernel.items.recordNotReady(simCaller(world, editor), both);
  expect(reasonOf(malformed)).toBe('malformed_command');
  expect(await missingEvidence(world, harness.id)).toEqual([
    {
      itemId: null,
      evidence: { via: 'kickstart', issue: null, pageId, title: 'Show the board' },
    },
  ]);
}

describe('EI-2 intake refuses an issue without a done-when and records it on the harness', () => {
  it('refuses an import done_when_missing and records the refusal once a day', () =>
    inWorld(async (world) => {
      const { harness } = await createSimHarness(world, software);
      expect(reasonOf(await importWithout(world, harness.id))).toBe('done_when_missing');
      expect(reasonOf(await importWithout(world, harness.id))).toBe('done_when_missing');
      expect(await missingEvidence(world, harness.id)).toEqual([
        { itemId: null, evidence: { via: 'import', issue, pageId: null, title: 'Wire the board' } },
      ]);
      world.adapters.clock.advance(DAY_MS + 1);
      expect(reasonOf(await importWithout(world, harness.id))).toBe('done_when_missing');
      expect(await missing(world, harness.id)).toHaveLength(2);
    }));

  it('imports once a done-when is there, and never checks an imported issue again', () =>
    inWorld(async (world) => {
      const { harness } = await createSimHarness(world, software);
      const first = value(await importWithout(world, harness.id, ['The board lists every stage.']));
      expect(first.created).toBe(true);
      const again = value(await importWithout(world, harness.id));
      expect(again).toEqual({ item: first.item, created: false });
      expect(await missing(world, harness.id)).toHaveLength(0);
    }));

  it('records a kickstart refusal against the page, for a person with write, and refuses an agent', () =>
    inWorld(kickstartNotReady));
});
