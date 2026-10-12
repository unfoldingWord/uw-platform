import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { rewriteHarnessRepository } from '@uw/db/test-seed';
import { notWiredCall, createKernel, software, type ConnectorRequest } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller, simPerson } from '../fixtures.ts';
import { kernelThatLosesTheExit } from '../lost-exit.ts';
import {
  approvedBy,
  greenFacts,
  shipBase,
  shipPullRequest,
  simParkedAtShip,
  standardChange,
} from '../ship-fixtures.ts';
import { createWorld } from '../world.ts';

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
