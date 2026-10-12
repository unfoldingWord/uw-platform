import assert from 'node:assert/strict';
import type { Principal } from '@uw/contracts';
import { readAllEvents, software, type KernelOutcome } from '@uw/harness';
import {
  createSimHarness,
  simAgent,
  simCaller,
  simDelegate,
  simParkedAtCheck,
  simPerson,
} from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';
import type { World } from '../world.ts';

const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;

function valueOf<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

async function beatPrincipalOf(world: World, harnessId: string, kim: Principal) {
  const delegation = valueOf(
    await simDelegate(world, kim, {
      harnessId,
      persona: 'agent:iterate',
      capability: 'iterate',
      expiresAt: null,
      supersedes: null,
    }),
  );
  const iterate = simCaller(world, simAgent(kim, 'iterate', { interactive: false }));
  const beat = valueOf(
    await world.kernel.delegations.beat(iterate, { delegationId: delegation.id }),
  );
  return beat.principal;
}

async function agentsOf(world: World, harnessId: string, ian: Principal) {
  const kim = await simPerson(world, 4, [{ role: 'admin', ...area }]);
  const max = await simPerson(world, 5, [{ role: 'editor', ...area }]);
  const vic = await simPerson(world, 6, [{ role: 'viewer', ...area }]);
  return [
    simAgent(ian, 'reviewer', { interactive: true }),
    simAgent(kim, `${kim.personId}/builder`, { interactive: false }),
    simAgent(max, `${max.personId}/builder`, { interactive: true }),
    simAgent(vic, `${vic.personId}/builder`, { interactive: true }),
    await beatPrincipalOf(world, harnessId, kim),
  ];
}

export const scenario = defineScenario({
  id: 'KN-13',
  title:
    'no agent principal can write a gate decision, whatever its grants or delegation: each call records gate_refused_to_agent and changes nothing else',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    const parked = await simParkedAtCheck(world, {
      harnessId: harness.id,
      admin,
      title: 'Gate the board',
    });
    const agents = await agentsOf(world, harness.id, admin);
    for (const agent of agents) {
      const outcome = await world.kernel.gates.decide(simCaller(world, agent), {
        itemId: parked.itemId,
        decision: 'approve',
        reason: null,
        findings: [],
      });
      assert.equal(outcome.status === 'error' && outcome.reason, 'gate_refused_to_agent');
    }
    const after = await world.adapters.store.transaction(async (tx) => ({
      decisions: await tx.gateDecisions.read.forItem(parked.itemId),
      item: await tx.harnessItems.read.byId(parked.itemId),
      events: await readAllEvents(tx, harness.id, parked.itemId),
    }));
    assert.deepEqual(after.decisions, []);
    assert.ok(after.item);
    assert.equal(after.item.stageKey, 'check');
    assert.equal(after.item.gateStatus, 'parked');
    assert.equal(after.item.holder, null);
    const names = after.events.map((event) => event.name);
    const tail = names.slice(names.lastIndexOf('submitted_to_gate') + 1);
    assert.deepEqual(
      tail,
      Array.from({ length: 5 }, () => 'gate_refused_to_agent'),
    );
    const refusals = after.events.filter((event) => event.name === 'gate_refused_to_agent');
    assert.deepEqual(
      refusals.map((event) => event.actor),
      agents.map((agent) => agent.identity),
    );
    assert.ok(refusals.every((event) => event.evidence['stage'] === 'check'));
    return { state: { refused: refusals.length, decisions: after.decisions.length } };
  },
});
