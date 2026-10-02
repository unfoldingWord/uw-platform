import { principalSchema, type Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software, type Caller } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import {
  agentAttempts,
  gateViolations,
  stageViolations,
  type AgentAttempt,
  type Decide,
  type UpdateStage,
  type Violation,
} from '../agent-boundary.ts';
import { createSimHarness, simParkedAtCheck } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = {
  readonly world: World;
  readonly target: { readonly itemId: string; readonly harnessId: string };
  readonly attempts: readonly AgentAttempt[];
};

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    const parked = await simParkedAtCheck(world, { harnessId: harness.id, admin, title: 'Gate' });
    const attempts = await agentAttempts(world, harness.id);
    await work({ world, target: { itemId: parked.itemId, harnessId: harness.id }, attempts });
  } finally {
    await world.close();
  }
}

function laundered(caller: Caller): Caller {
  const { actor } = caller;
  const human: Principal = principalSchema.parse({
    identity: `human:${actor.personId ?? ''}`,
    kind: 'person',
    personId: actor.personId,
    email: 'laundered@unfoldingword.org',
    grants: actor.grants,
    interactive: true,
  });
  return { ...caller, actor: human };
}

function bypassingDecide(world: World): Decide {
  return (caller, input) => world.kernel.gates.decide(laundered(caller), input);
}

function acceptingDecide(world: World): Decide {
  return async (_caller, input) => {
    const item = await world.adapters.store.transaction((tx) =>
      tx.harnessItems.read.byId(input.itemId),
    );
    if (item === null) throw new Error('the planted decide lost the item');
    return { status: 'accepted', value: { decisionId: input.itemId, item, advanced: false } };
  };
}

const silentDecide: Decide = async (caller) => ({
  status: 'error',
  reason: 'not_permitted',
  detail: { actor: caller.actor.identity },
});

function bypassingUpdate(world: World): UpdateStage {
  return (caller, input) => world.kernel.stages.updateStage(laundered(caller), input);
}

function labelsWith(violations: readonly Violation[], why: string): ReadonlySet<string> {
  return new Set(violations.filter((v) => v.why.includes(why)).map((v) => v.label));
}

async function bypassIsCaught(scene: Scene): Promise<void> {
  const { world, target, attempts } = scene;
  const violations = await gateViolations(world, target, attempts, bypassingDecide(world));
  const accepted = labelsWith(violations, 'accepted');
  expect(accepted).toContain('admin org, bare persona agent:reviewer');
  expect(violations.some((v) => v.label === 'gate_decisions')).toBe(true);
  expect(violations.some((v) => v.why.startsWith('the item moved'))).toBe(true);
}

async function acceptanceIsCaught(scene: Scene): Promise<void> {
  const { world, target, attempts } = scene;
  const violations = await gateViolations(world, target, attempts, acceptingDecide(world));
  const accepted = labelsWith(violations, 'the decision was accepted');
  expect([...accepted].sort()).toEqual(attempts.map((attempt) => attempt.label).sort());
}

async function silenceIsCaught(scene: Scene): Promise<void> {
  const { world, target, attempts } = scene;
  const violations = await gateViolations(world, target, attempts, silentDecide);
  expect(labelsWith(violations, 'the log gained []').size).toBe(attempts.length);
  expect(labelsWith(violations, 'replied not_permitted').size).toBe(attempts.length);
}

async function stageBypassIsCaught(scene: Scene): Promise<void> {
  const { world, target, attempts } = scene;
  const violations = await stageViolations(
    world,
    target.harnessId,
    attempts,
    bypassingUpdate(world),
  );
  const first = 'admin org, bare persona agent:reviewer, ';
  expect(violations.some((v) => v.startsWith(first) && v.endsWith(': accepted'))).toBe(true);
  expect(violations).toContain('harness_stages changed');
}

describe('AB-7 the runtime check fails on a planted gate command that lets an agent decide', () => {
  it('names the attempts a planted decide that launders the agent into a person lets through', () =>
    inScene(bypassIsCaught));

  it('names every attempt a planted decide accepts without writing anything', () =>
    inScene(acceptanceIsCaught));

  it('flags a planted decide that refuses not_permitted and records no event', () =>
    inScene(silenceIsCaught));

  it('flags a planted stage command that lets a laundered agent lower a gate', () =>
    inScene(stageBypassIsCaught));
});

async function everyFormIsBuilt({ attempts }: Scene): Promise<void> {
  const labels = attempts.map((attempt) => attempt.label);
  const identities = attempts.map((attempt) => attempt.actor.identity);
  expect(attempts).toHaveLength(13 * 4 + 2);
  expect(new Set(labels).size).toBe(attempts.length);
  expect(identities.filter((identity) => !identity.startsWith('agent:'))).toEqual([]);
}

describe('the runtime boundary check builds every grant combination and identity form', () => {
  it('builds four identity forms for no grant, nine role and scope pairs and three expired grants, plus a delegated device and a beat', () =>
    inScene(everyFormIsBuilt));
});
