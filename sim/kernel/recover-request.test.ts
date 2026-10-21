import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { rewriteHarnessRepository } from '@uw/db/test-seed';
import {
  notWiredCall,
  createKernel,
  software,
  type ConnectorRequest,
  type GitHubFacts,
  type PullRequestFacts,
} from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller, simPerson } from '../fixtures.ts';
import { kernelThatLosesTheExit } from '../lost-exit.ts';
import {
  approvedBy,
  comparedAt,
  greenFacts,
  itemLog,
  shipBase,
  shipPullRequest,
  simParkedAtShip,
  simPatchId,
  simSha,
  standardChange,
} from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const head = standardChange.head;

describe('GH-6 a recovery asks about the merge the decision made', () => {
  it('names the repository and base recorded at decision time, not the harness’s current repository', async () => {
    const world = await createWorld();
    try {
      const { harness, admin } = await createSimHarness(world, software);
      const editor = await simPerson(world, 2, [
        { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
      ]);
      const { itemId } = await simParkedAtShip(world, {
        harnessId: harness.id,
        editor,
        title: 'Show the board',
        change: standardChange,
      });
      const reviews = [approvedBy('uw-reviewer[bot]', 'anthropic', head, 9100000101)];
      world.adapters.githubFacts.given(greenFacts(world, { itemId, head, reviews }));
      const losing = kernelThatLosesTheExit(world, { effectHappened: true });
      const approve = { decision: 'approve' as const, reason: null, findings: [] };
      const decision = { ...approve, itemId, seenHead: head };
      await expect(losing.gates.decide(simCaller(world, admin), decision)).rejects.toMatchObject({
        name: 'ExitLost',
      });
      await rewriteHarnessRepository(world.database.db, harness.id, 'unfoldingWord/elsewhere');
      world.adapters.clock.advance(16 * 60_000);
      const asked: ConnectorRequest[] = [];
      const kernel = createKernel({
        ...world.adapters,
        connectors: {
          run: (request) => world.adapters.connectors.run(request),
          outcomeOf: (request) => {
            asked.push(request);
            return world.adapters.connectors.outcomeOf(request);
          },
          review: () => notWiredCall('connectors', 'review'),
        },
      });
      const recovered = await kernel.gates.recoverConnectors(simCaller(world, admin), {
        harnessId: harness.id,
      });
      expect(recovered).toMatchObject({ value: { items: [{ itemId, outcome: 'succeeded' }] } });
      expect(asked.map((request) => [request.repository, request.expectedBase])).toEqual([
        [shipPullRequest.repo, { sha: shipBase, ref: 'main' }],
      ]);
    } finally {
      await world.close();
    }
  });
});

const carriedHead = simSha('b4e2');

function carriedFacts(world: World, itemId: string): PullRequestFacts {
  const reviews = [approvedBy('uw-reviewer[bot]', 'anthropic', head, 9100000101)];
  const facts = greenFacts(world, { itemId, head: carriedHead, reviews });
  const commits = [
    { sha: head, merge: false, skipCi: false, closes: [] },
    { sha: carriedHead, merge: true, skipCi: false, closes: [] },
  ];
  const patchId = simPatchId('9a7c');
  const patchIds = { [head]: patchId, [carriedHead]: patchId };
  return { ...facts, comparison: comparedAt(carriedHead, { commits, patchIds, patchId }) };
}

function carriedAtExit(world: World, itemId: string): GitHubFacts {
  const facts = world.adapters.githubFacts;
  let reads = 0;
  return {
    ...facts,
    refresh: async (ref) => {
      reads += 1;
      if (reads === 2) facts.given(carriedFacts(world, itemId));
      return facts.refresh(ref);
    },
  };
}

async function lostAtCarriedHead(world: World): Promise<void> {
  const { harness, admin } = await createSimHarness(world, software);
  const change = { harnessId: harness.id, editor: admin, title: 'Show the board' };
  const { itemId } = await simParkedAtShip(world, { ...change, change: standardChange });
  const reviews = [approvedBy('uw-reviewer[bot]', 'anthropic', head, 9100000101)];
  world.adapters.githubFacts.given(greenFacts(world, { itemId, head, reviews }));
  const githubFacts = carriedAtExit(world, itemId);
  const losing = kernelThatLosesTheExit(world, { effectHappened: true, githubFacts });
  const decision = { decision: 'approve' as const, reason: null, findings: [], seenHead: head };
  await expect(
    losing.gates.decide(simCaller(world, admin), { ...decision, itemId }),
  ).rejects.toMatchObject({ name: 'ExitLost' });
  expect(world.adapters.connectors.calls().map((call) => call.expectedHead)).toEqual([carriedHead]);
  world.adapters.clock.advance(16 * 60_000);
  const recovered = await world.kernel.gates.recoverConnectors(simCaller(world, admin), {
    harnessId: harness.id,
  });
  expect(recovered).toMatchObject({ value: { items: [{ itemId, outcome: 'lost' }] } });
  const log = await itemLog(world, harness.id, itemId);
  expect(log.events.at(-1)).toMatchObject({
    name: 'connector_refused',
    evidence: { reason: 'connector_lost' },
  });
}

describe('SR-2 SR-3 the known limit of a recovery after a carried merge', () => {
  it('SR-2 a recovered exit whose merge used a carried head asks about the decision head and records connector_lost', async () => {
    const world = await createWorld();
    try {
      await lostAtCarriedHead(world);
    } finally {
      await world.close();
    }
  });
});
