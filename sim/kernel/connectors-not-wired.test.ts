import type { Harness, Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software, type Caller, type EffectConnector, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller, simPerson } from '../fixtures.ts';
import { readWorldLog } from '../runner/log.ts';
import {
  approvedBy,
  greenFacts,
  itemLog,
  namesSince,
  simParkedAtShip,
  standardChange,
} from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const unwired = ['deploy', 'publish', 'send', 'post'] as const satisfies EffectConnector[];

type Scene = { readonly world: World; readonly harness: Harness; readonly ian: Principal };

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    await work({ world, harness, ian: admin });
    expect((await readWorldLog(world.adapters.store)).drift).toEqual([]);
  } finally {
    await world.close();
  }
}

function connectorsCalled(world: World): string[] {
  return world.adapters.connectors.calls().map((call) => call.connector);
}

function value<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

function stageWith(connector: (typeof unwired)[number]) {
  return {
    key: `extra_${connector}`,
    title: `Extra ${connector}`,
    position: 90 + unwired.indexOf(connector),
    bracket: 'iterate' as const,
    agentPickup: 'allowed' as const,
    exitGate: 'human_approval' as const,
    connector,
    wipLimit: 3,
    instructionsPageId: null,
    validators: [],
    feeds: [],
  };
}

async function parkedAtSendStage(scene: Scene, ian: Caller): Promise<string> {
  const { world, harness } = scene;
  value(
    await world.kernel.stages.updateStage(ian, {
      harnessId: harness.id,
      stageKey: 'ship',
      change: { connector: 'send' },
    }),
  );
  const max = await simPerson(world, 2, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const parked = await simParkedAtShip(world, {
    harnessId: harness.id,
    editor: max,
    title: 'Send the newsletter',
    change: standardChange,
  });
  const { head } = standardChange;
  const reviews = [approvedBy('uw-reviewer[bot]', 'anthropic', head, 9100000101)];
  world.adapters.githubFacts.given(greenFacts(world, { itemId: parked.itemId, head, reviews }));
  return parked.itemId;
}

describe('GH-7 deploy, publish, send and post are registered and answer not wired as an event', () => {
  it('accepts a stage with each of the four connectors', () =>
    inScene(async (scene) => {
      const ian = simCaller(scene.world, scene.ian);
      for (const connector of unwired) {
        const created = await scene.world.kernel.stages.createStage(ian, {
          harnessId: scene.harness.id,
          stage: stageWith(connector),
        });
        expect([connector, created.status]).toEqual([connector, 'accepted']);
      }
    }));

  it('records connector_refused not_wired for an approved item at a send stage and keeps it parked', () =>
    inScene(async (scene) => {
      const { world, harness } = scene;
      const ian = simCaller(world, scene.ian);
      const itemId = await parkedAtSendStage(scene, ian);
      world.adapters.connectors.refuseNext('send', 'not_wired');
      const before = await itemLog(world, harness.id, itemId);
      const decided = value(
        await world.kernel.gates.decide(ian, {
          itemId,
          decision: 'approve',
          reason: null,
          findings: [],
        }),
      );
      expect(decided).toMatchObject({
        advanced: false,
        item: { stageKey: 'ship', gateStatus: 'parked' },
      });
      const after = await itemLog(world, harness.id, itemId);
      expect(namesSince(before, after).slice(-1)).toEqual(['connector_refused']);
      expect(after.events.at(-1)?.evidence).toEqual({ connector: 'send', reason: 'not_wired' });
      expect(connectorsCalled(world)).toEqual(['send']);
    }));
});
