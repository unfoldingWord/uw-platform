import assert from 'node:assert/strict';
import type { ExitGate, HarnessEvent, Stage } from '@uw/contracts';
import { itemLog } from '../ship-fixtures.ts';
import type { Cast, Journey } from './cast.ts';

const software = ['package', 'scope', 'plan', 'build', 'check', 'ship', 'validate', 'close'];

const milestones = [
  'item_created',
  'item_claimed',
  'risk_derived',
  'lease_expired',
  'branch_abandoned',
  'submitted_to_gate',
  'ship_refused',
  'ship_refused',
  'gate_refused_to_agent',
  'gate_refused_to_agent',
  'gate_approved',
  'connector_succeeded',
  'measurement_recorded',
  'run_started',
  'checks_failed',
  'delegation_required',
  'learning_attached',
  'run_stopped',
  'stage_advanced',
] as const;

function travelled(events: readonly HarnessEvent[]): readonly string[] {
  const advances = events.filter((event) => event.name === 'stage_advanced');
  const visited = advances.map((event) => String(event.evidence['from']));
  assert.deepEqual(visited, software, 'the item did not travel Package to Close in order');
  assert.equal(advances.at(-1)?.evidence['to'], null, 'the last advance did not close the item');
  return visited;
}

function onAWalkedPath(cast: Cast, visited: readonly string[]): void {
  const route = visited.join(' > ');
  const walked = cast.world.kernel.walk(cast.stages).some((path) => {
    const prefix = path.slice(0, visited.length).filter((step) => !step.revisited);
    return prefix.map((step) => step.key).join(' > ') === route;
  });
  assert.ok(walked, 'no walked path of the software template matches the route the item took');
}

function gatesCrossed(stages: readonly Stage[], visited: readonly string[]): readonly ExitGate[] {
  const byKey = new Map(stages.map((stage) => [stage.key, stage.exitGate]));
  const gates = new Set(visited.map((key) => byKey.get(key)));
  const crossed = [...gates].filter((gate): gate is ExitGate => gate !== undefined).toSorted();
  assert.deepEqual(crossed, ['checks', 'human_approval', 'none'], 'an exit gate kind was missed');
  return crossed;
}

function mergedAfterAPerson(events: readonly HarnessEvent[]): void {
  const names = events.map((event) => event.name);
  const approvals = events.filter((event) => event.name === 'gate_approved');
  assert.equal(approvals.length, 1, 'the item was approved more than once');
  assert.ok(approvals[0]?.actor.startsWith('human:'), 'the approval was not a person');
  const approvedAt = names.indexOf('gate_approved');
  const firstEffect = names.findIndex((name) => name.startsWith('connector_'));
  assert.ok(firstEffect > approvedAt, 'a connector ran before the person approved');
  assert.ok(
    names.indexOf('connector_succeeded') > approvedAt,
    'the merge did not follow the approval',
  );
}

function inOrder(names: readonly string[], wanted: readonly string[]): void {
  const remaining = [...wanted];
  for (const name of names) {
    if (name === remaining.at(0)) remaining.shift();
  }
  assert.deepEqual(remaining, [], `the milestone ${String(remaining.at(0))} is missing or late`);
}

export async function everyGateCrossed(journey: Journey): Promise<readonly ExitGate[]> {
  const { cast } = journey;
  const main = await itemLog(cast.world, cast.harnessId, journey.itemId);
  const wrong = await itemLog(cast.world, cast.harnessId, journey.wrongItemId);
  const visited = travelled(main.events);
  onAWalkedPath(cast, visited);
  const gates = gatesCrossed(cast.stages, visited);
  mergedAfterAPerson(main.events);
  assert.deepEqual(main.decisions, ['approve'], 'the gate holds a decision other than one approve');
  inOrder(
    main.events.map((event) => event.name),
    milestones,
  );
  const held = wrong.events.filter((event) => event.name === 'premise_held');
  assert.equal(held.length, 1, 'the wrong premise was not held exactly once');
  return gates;
}
