import assert from 'node:assert/strict';
import { software } from '@uw/harness';
import { agentAttempts, gateViolations, stageViolations } from '../agent-boundary.ts';
import { createSimHarness, simParkedAtCheck, simPerson } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';
import { simParkedAtShip, standardChange } from '../ship-fixtures.ts';

export const scenario = defineScenario({
  id: 'AB-7',
  title:
    'no agent identity, in any grant combination or identity form, writes a gate decision or lowers a gate: every attempt at a decision records gate_refused_to_agent and changes nothing else',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    const editor = await simPerson(world, 2, [
      { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    const atShip = await simParkedAtShip(world, {
      harnessId: harness.id,
      editor,
      title: 'Ship the board',
      change: standardChange,
    });
    const atCheck = await simParkedAtCheck(world, {
      harnessId: harness.id,
      admin,
      title: 'Gate the board',
    });
    const attempts = await agentAttempts(world, harness.id);
    const { decide } = world.kernel.gates;
    for (const parked of [atCheck, atShip]) {
      const target = { itemId: parked.itemId, harnessId: harness.id };
      assert.deepEqual(await gateViolations(world, target, attempts, decide), []);
    }
    const updateStage = world.kernel.stages.updateStage;
    assert.deepEqual(await stageViolations(world, harness.id, attempts, updateStage), []);
    return { state: { attempts: attempts.length, decisions: 0 } };
  },
});
