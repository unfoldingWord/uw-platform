import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { simAgent, simCaller, simPerson } from '../fixtures.ts';
import { claimFix, fixWorld, offeredTo, type FixOptions, type FixWorld } from '../fix-claims.ts';
import { harnessNames, itemEvents, itemOf } from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Work = (scene: FixWorld) => Promise<void>;

async function inScene(options: FixOptions, work: Work): Promise<void> {
  const world = await createWorld();
  try {
    await work(await fixWorld(world, options));
  } finally {
    await world.close();
  }
}

function author(scene: FixWorld) {
  return simAgent(scene.admin, `${scene.admin.personId ?? ''}/builder`, { interactive: true });
}

function isFixClaimed(name: string): boolean {
  return name === 'fix_claimed';
}

async function names(scene: FixWorld): Promise<readonly string[]> {
  return (await itemEvents(scene, scene.itemId)).map((event) => event.name);
}

function authorClaims(scene: FixWorld) {
  const input = { itemId: scene.itemId, delegationId: null };
  return scene.world.kernel.items.claim(simCaller(scene.world, author(scene)), input);
}

const switchedOnce: Work = async (scene) => {
  const admin = simCaller(scene.world, scene.admin);
  const input = { harnessId: scene.harnessId, enabled: true };
  expect(await scene.world.kernel.stages.setFixClaim(admin, input)).toMatchObject({
    status: 'accepted',
    value: { harness: { fixClaim: true } },
  });
  await scene.world.kernel.stages.setFixClaim(admin, input);
  const set = (await harnessNames(scene)).filter((name) => name === 'fix_claim_set');
  expect(set).toHaveLength(1);
};

const onlyAdmins: Work = async (scene) => {
  const editor = await simPerson(scene.world, 7, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const input = { harnessId: scene.harnessId, enabled: true };
  for (const actor of [editor, scene.fixer]) {
    const outcome = await scene.world.kernel.stages.setFixClaim(
      simCaller(scene.world, actor),
      input,
    );
    expect(outcome.status).toBe('error');
  }
};

const offWhileOff: Work = async (scene) => {
  expect(await offeredTo(scene, scene.fixer)).not.toContain(scene.itemId);
  const reads = vi.spyOn(scene.world.adapters.githubFacts, 'pullRequest');
  expect(await claimFix(scene)).toMatchObject({
    status: 'error',
    reason: 'pickup_not_allowed',
    detail: { capability: 'fix', why: 'fix_claim_off' },
  });
  expect(reads).not.toHaveBeenCalled();
  expect((await names(scene)).some(isFixClaimed)).toBe(false);
};

const takesTheRound: Work = async (scene) => {
  expect(await offeredTo(scene, scene.fixer)).toContain(scene.itemId);
  expect(await claimFix(scene)).toMatchObject({ status: 'accepted' });
  const events = await itemEvents(scene, scene.itemId);
  const claimed = events.findLast((event) => isFixClaimed(event.name));
  expect(claimed?.evidence).toMatchObject({ delegationId: scene.fixId, head: scene.head });
  expect(claimed?.evidence['declaration']).toMatchObject({ riskTier: 'standard' });
  expect(await itemOf(scene.world, scene.itemId)).toMatchObject({
    holder: scene.fixer.identity,
    delegationId: scene.fixId,
  });
};

const noRound: Work = async (scene) => {
  expect(await offeredTo(scene, scene.fixer)).not.toContain(scene.itemId);
  expect(await claimFix(scene)).toMatchObject({
    status: 'error',
    reason: 'pickup_not_allowed',
    detail: { why: 'no_review_round' },
  });
};

const fixerHolds: Work = async (scene) => {
  expect(await claimFix(scene)).toMatchObject({ status: 'accepted' });
  expect(await authorClaims(scene)).toMatchObject({ status: 'error', reason: 'lease_held' });
};

const authorHolds: Work = async (scene) => {
  expect(await authorClaims(scene)).toMatchObject({ status: 'accepted' });
  expect(await offeredTo(scene, scene.fixer)).not.toContain(scene.itemId);
  expect(await claimFix(scene)).toMatchObject({ status: 'error', reason: 'lease_held' });
};

const oncePerRound: Work = async (scene) => {
  expect(await claimFix(scene)).toMatchObject({ status: 'accepted' });
  const released = await scene.world.kernel.items.release(simCaller(scene.world, scene.fixer), {
    itemId: scene.itemId,
    delegationId: scene.fixId,
  });
  expect(released.status).toBe('accepted');
  await noRound(scene);
};

describe('FL-1 the fix claim is off until an admin turns it on', () => {
  it('FL-1 an admin switches it with one event; the same state again records nothing', () =>
    inScene({ fixClaim: false }, switchedOnce));

  it('FL-1 an editor and an agent cannot switch it', () =>
    inScene({ fixClaim: false }, onlyAdmins));

  it('FL-1 while it is off the Builder is never offered the reviewed item and its fix claim is refused', () =>
    inScene({ fixClaim: false }, offWhileOff));
});

describe('FL-2 a review round offers the item once to the Builder under a fix delegation', () => {
  it('FL-2 after a real finding the Builder is offered the item and takes it, recording head and declaration', () =>
    inScene({}, takesTheRound));

  it('FL-2 a round of theoretical findings only offers nothing', () =>
    inScene({ weight: 'theoretical' }, noRound));

  it('FL-2 one identity holds the branch: the author is refused lease_held while the fix claim is live', () =>
    inScene({}, fixerHolds));

  it('FL-2 the fixer is refused lease_held while the author holds the item', () =>
    inScene({}, authorHolds));

  it('FL-2 one fix claim per round: once released, the round is not offered again', () =>
    inScene({}, oncePerRound));
});
