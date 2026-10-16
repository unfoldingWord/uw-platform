import assert from 'node:assert/strict';
import { software } from '@uw/harness';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { approvedBy, greenFacts, simParkedAtShip, standardChange } from '../ship-fixtures.ts';

export const scenario = defineScenario({
  id: 'PI-1',
  title:
    'a high-tier change approved by the platform Reviewer and a listed external reviewer passes distinctness; two external reviewers alone do not',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software, {
      externalReviewerIdentities: ['uwreview[bot]', 'benchbot[bot]'],
    });
    const change = {
      ...standardChange,
      declaration: { riskTier: 'high' as const, riskDomains: [] },
    };
    const parked = await simParkedAtShip(world, {
      harnessId: harness.id,
      editor: admin,
      title: 'Show the board',
      change,
    });
    const { head } = change;
    const viewWith = async (reviews: Parameters<typeof greenFacts>[1]['reviews']) => {
      world.adapters.githubFacts.given(greenFacts(world, { itemId: parked.itemId, head, reviews }));
      const view = value(
        await world.kernel.gates.view(simCaller(world, admin), { itemId: parked.itemId }),
      );
      return view.ship?.outcome;
    };
    const mixed = await viewWith([
      approvedBy('uw-reviewer[bot]', 'deepinfra', head, 9300000001),
      approvedBy('uwreview[bot]', null, head, 9300000002),
    ]);
    const externalOnly = await viewWith([
      approvedBy('uwreview[bot]', null, head, 9300000002),
      approvedBy('benchbot[bot]', null, head, 9300000003),
    ]);
    assert.equal(
      mixed?.verdict === 'refuse' && mixed.reasons.includes('reviewer_providers_not_distinct'),
      false,
    );
    assert.equal(
      externalOnly?.verdict === 'refuse' &&
        externalOnly.reasons.includes('reviewer_providers_not_distinct'),
      true,
    );
    return { state: { mixed, externalOnly } };
  },
});
