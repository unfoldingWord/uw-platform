import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { declared } from '../ship-fixtures.ts';
import { simAgent, simCaller } from '../fixtures.ts';
import { claimFix, fixHead, fixWorld, pushedFix, submitFix, type FixWorld } from '../fix-claims.ts';
import { shipPullRequest } from '../ship-fixtures.ts';
import { itemEvents, itemOf, value } from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const pull = { 'apps/uw-app/board.tsx': 40 };

type Work = (scene: FixWorld) => Promise<void>;

async function claimed(work: Work): Promise<void> {
  const world = await createWorld();
  try {
    const scene = await fixWorld(world);
    value(await claimFix(scene));
    await work(scene);
  } finally {
    await world.close();
  }
}

async function tailNames(scene: FixWorld, count: number): Promise<readonly string[]> {
  const events = await itemEvents(scene, scene.itemId);
  return events.slice(-count).map((event) => event.name);
}

const passes: Work = async (scene) => {
  pushedFix(scene, { pull, fix: { 'apps/uw-app/board.tsx': 8, 'apps/uw-app/board.test.tsx': 2 } });
  expect(await submitFix(scene)).toMatchObject({
    status: 'accepted',
    value: { result: 'awaiting_review', failures: [] },
  });
  expect(await itemOf(scene.world, scene.itemId)).toMatchObject({
    stageKey: 'check',
    expectedHead: fixHead,
    holder: null,
    gateStatus: 'working',
  });
  expect(await tailNames(scene, 2)).toEqual(['submitted_to_gate', 'item_released']);
};

const overTheCap: Work = async (scene) => {
  pushedFix(scene, { pull, fix: { 'apps/uw-app/board.tsx': 11 } });
  expect(await submitFix(scene)).toMatchObject({ status: 'error', reason: 'fix_size_cap' });
  expect(await itemOf(scene.world, scene.itemId)).toMatchObject({
    expectedHead: scene.head,
    holder: null,
    gateStatus: 'checks_failed',
  });
  expect(await tailNames(scene, 2)).toEqual(['checks_failed', 'item_released']);
};

const strayFile: Work = async (scene) => {
  pushedFix(scene, { pull, fix: { 'apps/uw-app/billing.ts': 2 } });
  expect(await submitFix(scene)).toMatchObject({
    status: 'error',
    reason: 'fix_size_cap',
    detail: {
      failures: [
        'fix_size_cap: the fix touches apps/uw-app/billing.ts, which the pull request does not',
      ],
    },
  });
};

const unmeasured: Work = async (scene) => {
  pushedFix(scene, { pull, fix: null });
  expect(await submitFix(scene)).toMatchObject({ status: 'error', reason: 'fix_size_cap' });
};

const purposeChanged: Work = async (scene) => {
  const changed = declared({ riskTier: 'low', riskDomains: [] });
  pushedFix(scene, { pull, fix: { 'apps/uw-app/board.tsx': 4 }, declaration: changed });
  expect(await submitFix(scene)).toMatchObject({ status: 'error', reason: 'fix_keeps_purpose' });
  expect(await itemOf(scene.world, scene.itemId)).toMatchObject({
    expectedHead: scene.head,
    holder: null,
  });
};

const changesNothing: Work = async (scene) => {
  pushedFix(scene, { pull, fix: {} });
  expect(await submitFix(scene)).toMatchObject({
    status: 'error',
    reason: 'fix_size_cap',
    detail: { failures: ['fix_size_cap: the fix changes nothing'] },
  });
  expect(await itemOf(scene.world, scene.itemId)).toMatchObject({ expectedHead: scene.head });
};

const otherPullRequest: Work = async (scene) => {
  pushedFix(scene, { pull, fix: { 'apps/uw-app/board.tsx': 4 } });
  const other = { ...shipPullRequest, number: shipPullRequest.number + 1 };
  const outcome = await scene.world.kernel.items.submit(simCaller(scene.world, scene.fixer), {
    itemId: scene.itemId,
    to: null,
    evidence: {},
    change: { pullRequest: other, head: fixHead },
  });
  expect(outcome).toMatchObject({ status: 'error' });
  const failures = outcome.status === 'error' ? outcome.detail['failures'] : null;
  expect(failures).toContain(
    "fix_keeps_purpose: the fix names a pull request other than the item's",
  );
  expect(await itemOf(scene.world, scene.itemId)).toMatchObject({
    expectedHead: scene.head,
    holder: null,
  });
};

describe('FL-3 a fix that keeps to the rules waits at its stage for the next review', () => {
  it('FL-3 within a quarter of the lines, on the pull request files and a test, it answers awaiting_review', () =>
    claimed(passes));
});

describe('FL-3 a fix over the cap or off its purpose is refused with its own reason and releases the claim', () => {
  it('FL-3 fix_size_cap refuses more than a quarter, records checks_failed and keeps the reviewed head', () =>
    claimed(overTheCap));

  it('FL-3 fix_size_cap refuses a file the pull request does not touch', () => claimed(strayFile));

  it('FL-3 fix_size_cap refuses a fix it cannot measure', () => claimed(unmeasured));

  it('FL-3 fix_keeps_purpose refuses a declaration that changed during the fix', () =>
    claimed(purposeChanged));

  it('FL-3 fix_size_cap refuses a fix that changes nothing', () => claimed(changesNothing));

  it('FL-3 a fix submit that names another pull request is refused and keeps the reviewed head', () =>
    claimed(otherPullRequest));
});

describe('FL-3 a claim that is not a fix claim runs no fix validator', () => {
  it('FL-3 the author submits a large change at Check and advances as in v0.1.0', async () => {
    const world = await createWorld();
    try {
      const scene = await fixWorld(world);
      const author = simAgent(scene.admin, `${scene.admin.personId ?? ''}/builder`, {
        interactive: true,
      });
      const input = { itemId: scene.itemId, delegationId: null };
      value(await scene.world.kernel.items.claim(simCaller(world, author), input));
      pushedFix(scene, { pull, fix: { 'apps/uw-app/billing.ts': 400 } });
      expect(await submitFix(scene, author)).toMatchObject({
        status: 'accepted',
        value: { result: 'advanced' },
      });
    } finally {
      await world.close();
    }
  });
});
