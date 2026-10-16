import type { ItemState, Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software, type PullRequestFacts } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { reasonOf, value } from '../runs.ts';
import {
  approvedBy,
  comparedAt,
  greenFacts,
  itemLog,
  simParkedAtShip,
  simPatchId,
  simSha,
  standardChange,
} from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = { readonly world: World; readonly admin: Principal; readonly item: ItemState };

const approvedHead = standardChange.head;
const mergedHead = simSha('b4e2');

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    const item = await simParkedAtShip(world, {
      harnessId: harness.id,
      editor: admin,
      title: 'Show the board',
      change: standardChange,
    });
    await work({ world, admin, item });
  } finally {
    await world.close();
  }
}

function approved(scene: Scene, head: string): PullRequestFacts {
  const reviews = [approvedBy('uw-reviewer[bot]', 'deepinfra', approvedHead, 9300000001)];
  return greenFacts(scene.world, { itemId: scene.item.itemId, head, reviews });
}

function approve(scene: Scene) {
  return scene.world.kernel.gates.decide(simCaller(scene.world, scene.admin), {
    itemId: scene.item.itemId,
    decision: 'approve',
    reason: null,
    findings: [],
    seenHead: approvedHead,
  });
}

function withComparison(
  facts: PullRequestFacts,
  change: Parameters<typeof comparedAt>[1],
): PullRequestFacts {
  return { ...facts, comparison: comparedAt(facts.head, change) };
}

function calledHeads(world: World): readonly (string | null)[] {
  return world.adapters.connectors.calls().map((call) => call.expectedHead);
}

function decisionRows(scene: Scene) {
  return scene.world.adapters.store.transaction((tx) =>
    tx.gateDecisions.read.forItem(scene.item.itemId),
  );
}

const planted: readonly (readonly [string, (facts: PullRequestFacts) => PullRequestFacts])[] = [
  ['base_behind', (facts) => withComparison(facts, { behindBy: 2 })],
  [
    'auto_close_keyword',
    (facts) => ({ ...facts, closes: [{ repo: 'unfoldingWord/uw-platform', number: 99 }] }),
  ],
  [
    'skip_ci_marker',
    (facts) =>
      withComparison(facts, {
        commits: [{ sha: facts.head, merge: false, skipCi: true, closes: [] }],
      }),
  ],
  [
    'required_check_never_ran',
    (facts) => ({ ...facts, checks: facts.checks.filter((check) => check.name !== 'lint') }),
  ],
];

describe('SR-1 a person approving at Ship is refused on each new fact', () => {
  for (const [reason, plant] of planted) {
    it(`SR-1 refuses ${reason} and records it as ship_refused`, () =>
      inScene(async (scene) => {
        scene.world.adapters.githubFacts.given(plant(approved(scene, approvedHead)));
        expect(reasonOf(await approve(scene))).toBe(reason);
        const log = await itemLog(scene.world, scene.item.harnessId, scene.item.itemId);
        expect(log.events.at(-1)).toMatchObject({
          name: 'ship_refused',
          evidence: { reasons: [reason] },
        });
        expect(log.decisions).toEqual([]);
        expect(scene.world.adapters.connectors.calls()).toEqual([]);
      }));
  }
});

describe('SR-2 an approval carries across a merge from base', () => {
  it('SR-2 advances on a base merge after the approval, merges the new head and records both heads', () =>
    inScene(async (scene) => {
      const patchId = simPatchId('9a7c');
      const commits = [
        { sha: approvedHead, merge: false, skipCi: false, closes: [] },
        { sha: mergedHead, merge: true, skipCi: false, closes: [] },
      ];
      const patchIds = { [approvedHead]: patchId, [mergedHead]: patchId };
      scene.world.adapters.githubFacts.given(
        withComparison(approved(scene, mergedHead), { commits, patchIds, patchId }),
      );
      expect(value(await approve(scene)).advanced).toBe(true);
      expect(calledHeads(scene.world)).toEqual([mergedHead]);
      expect((await decisionRows(scene))[0]?.evidence).toMatchObject({
        head: mergedHead,
        approvals: [{ reviewer: 'uw-reviewer', commit: approvedHead, head: mergedHead }],
      });
    }));

  it('SR-2 refuses head_mismatch on a code change pushed after the approval', () =>
    inScene(async (scene) => {
      const commits = [
        { sha: approvedHead, merge: false, skipCi: false, closes: [] },
        { sha: mergedHead, merge: false, skipCi: false, closes: [] },
      ];
      const patchIds = { [approvedHead]: simPatchId('9a7c'), [mergedHead]: simPatchId('c0de') };
      const changed = withComparison(approved(scene, mergedHead), {
        commits,
        patchIds,
        patchId: simPatchId('c0de'),
      });
      scene.world.adapters.githubFacts.given(changed);
      expect(reasonOf(await approve(scene))).toBe('head_mismatch');
      expect(scene.world.adapters.connectors.calls()).toEqual([]);
    }));
});
