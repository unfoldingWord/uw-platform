import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software, type ReviewFact } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { value } from '../runs.ts';
import { approvedBy, greenFacts, simParkedAtShip, standardChange } from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Seen = { readonly approvals: unknown; readonly outcome: unknown };

async function shipSeen(
  world: World,
  external: readonly string[],
  reviews: (head: string) => readonly ReviewFact[],
): Promise<Seen> {
  const { harness, admin } = await createSimHarness(world, software, {
    externalReviewerIdentities: external,
  });
  const parked = await simParkedAtShip(world, {
    harnessId: harness.id,
    editor: admin,
    title: 'Show the board',
    change: standardChange,
  });
  const { head } = standardChange;
  world.adapters.githubFacts.given(
    greenFacts(world, { itemId: parked.itemId, head, reviews: reviews(head) }),
  );
  const view = value(
    await world.kernel.gates.view(simCaller(world, admin), { itemId: parked.itemId }),
  );
  return { approvals: view.ship?.input.approvals, outcome: view.ship?.outcome };
}

async function inWorld(work: (world: World) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(world);
  } finally {
    await world.close();
  }
}

function listedReviews(head: string): readonly ReviewFact[] {
  return [approvedBy('UWReview[bot]', null, head, 9300000001)];
}

function unlistedReviews(head: string): readonly ReviewFact[] {
  return [approvedBy('uwreview[bot]', null, head, 9300000001)];
}

describe("PI-1 a second reviewer's approval counts by configuration", () => {
  it('counts a listed login in any case with the provider external, and ignores it unlisted', () =>
    inWorld(async (world) => {
      const listed = await shipSeen(world, ['uwreview[bot]'], listedReviews);
      expect(listed.approvals).toEqual([
        { reviewer: 'uwreview', commit: standardChange.head, provider: 'external' },
      ]);
      expect(listed.outcome).toEqual({ verdict: 'advance' });
    }));

  it('refuses no_reviewer_approval when the login is not listed', () =>
    inWorld(async (world) => {
      const unlisted = await shipSeen(world, [], unlistedReviews);
      expect(unlisted.approvals).toEqual([]);
      expect(unlisted.outcome).toMatchObject({
        verdict: 'refuse',
        reasons: ['no_reviewer_approval'],
      });
    }));
});
