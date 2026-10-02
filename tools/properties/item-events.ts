import fc from 'fast-check';
import {
  newEventSchema,
  type EventName,
  type NewHarnessEvent,
} from '../../packages/contracts/index.ts';

const stageKeys = ['package', 'scope', 'plan', 'build', 'check', 'ship', 'validate', 'close'];
const harnessId = '00000000-0000-4000-8000-0000000000a1';
const itemId = '00000000-0000-4000-8000-0000000000b1';
const decisionId = '00000000-0000-4000-8000-0000000000d1';
const traceId = '00000000-0000-4000-8000-0000000000e1';
const agent = 'agent:builder';
const person = 'human:00000000-0000-4000-8000-000000000001';
const epoch = Date.parse('2026-10-01T09:00:00.000Z');
const minute = 60_000;

const operations = [
  'claim',
  'release',
  'renew',
  'expire',
  'submitParked',
  'submitAdvanced',
  'checksFailed',
  'reject',
  'takeOver',
  'loopEdge',
  'riskDerived',
] as const;

type Operation = (typeof operations)[number];
type Step = { readonly operation: Operation; readonly pick: number };

type Model = {
  stage: number;
  held: boolean;
  parked: boolean;
  done: boolean;
  count: number;
  readonly events: NewHarnessEvent[];
};

type Evidence = Record<string, unknown>;
type Handler = (model: Model, pick: number) => boolean;

function emit(model: Model, name: EventName, evidence: Evidence): void {
  model.count += 1;
  const instant = new Date(epoch + model.count * minute);
  model.events.push(
    newEventSchema.parse({
      eventId: `00000000-0000-4000-8000-${model.count.toString(16).padStart(12, '0')}`,
      harnessId,
      itemId,
      name,
      at: instant.toISOString(),
      actor: person,
      evidence,
      traceId,
    }),
  );
}

function leaseAfter(model: Model): string {
  return new Date(epoch + (model.count + 60) * minute).toISOString();
}

function stageKey(index: number): string {
  return stageKeys[index] ?? 'package';
}

function submit(model: Model, result: string, to: string | null): void {
  emit(model, 'submitted_to_gate', {
    stage: stageKey(model.stage),
    result,
    to,
    expectedHead: `head${model.count}`,
    pullRequest: null,
    evidence: {},
  });
}

function claim(model: Model): boolean {
  if (model.held || model.parked) return false;
  model.held = true;
  emit(model, 'item_claimed', {
    holder: agent,
    claimantKind: 'agent',
    delegationId: null,
    leaseExpiresAt: leaseAfter(model),
  });
  return true;
}

function release(model: Model): boolean {
  if (!model.held) return false;
  model.held = false;
  emit(model, 'item_released', { holder: agent });
  return true;
}

function renew(model: Model): boolean {
  if (!model.held) return false;
  emit(model, 'lease_renewed', { leaseExpiresAt: leaseAfter(model) });
  return true;
}

function expire(model: Model): boolean {
  if (!model.held) return false;
  model.held = false;
  emit(model, 'lease_expired', { holder: agent, leaseExpiresAt: leaseAfter(model) });
  return true;
}

function submitParked(model: Model, pick: number): boolean {
  if (!model.held) return false;
  model.held = false;
  model.parked = true;
  submit(model, 'parked', stageKey(pick % stageKeys.length));
  return true;
}

function submitAdvanced(model: Model): boolean {
  if (!model.held) return false;
  const from = stageKey(model.stage);
  const last = model.stage === stageKeys.length - 1;
  model.held = false;
  submit(model, 'advanced', last ? null : stageKey(model.stage + 1));
  emit(model, 'stage_advanced', { from, to: last ? null : stageKey(model.stage + 1) });
  model.done = last;
  model.stage = last ? model.stage : model.stage + 1;
  return true;
}

function checksFailed(model: Model): boolean {
  if (!model.held) return false;
  emit(model, 'checks_failed', { stage: stageKey(model.stage), failures: ['a check failed'] });
  return true;
}

function reject(model: Model): boolean {
  if (!model.parked) return false;
  model.parked = false;
  emit(model, 'gate_rejected', { decisionId, stage: stageKey(model.stage), findings: [] });
  return true;
}

function takeOver(model: Model): boolean {
  if (!model.parked) return false;
  model.parked = false;
  model.held = true;
  emit(model, 'gate_taken_over', { decisionId, stage: stageKey(model.stage), holder: person });
  return true;
}

function loopEdge(model: Model, pick: number): boolean {
  const to = pick % stageKeys.length;
  emit(model, 'loop_edge_taken', { from: stageKey(model.stage), to: stageKey(to) });
  model.stage = to;
  model.held = false;
  model.parked = false;
  return true;
}

function riskDerived(model: Model): boolean {
  emit(model, 'risk_derived', {
    paths: ['src/index.ts'],
    declaration: null,
    floorDomains: [],
    riskTier: 'low',
    riskDomains: [],
    refusal: null,
  });
  return true;
}

const handlers: ReadonlyMap<Operation, Handler> = new Map<Operation, Handler>([
  ['claim', claim],
  ['release', release],
  ['renew', renew],
  ['expire', expire],
  ['submitParked', submitParked],
  ['submitAdvanced', submitAdvanced],
  ['checksFailed', checksFailed],
  ['reject', reject],
  ['takeOver', takeOver],
  ['loopEdge', loopEdge],
  ['riskDerived', riskDerived],
]);

function walkSteps(start: number, steps: readonly Step[]): NewHarnessEvent[] {
  const model: Model = {
    stage: start,
    held: false,
    parked: false,
    done: false,
    count: 0,
    events: [],
  };
  emit(model, 'item_created', {
    stage: stageKey(start),
    title: 'Item',
    pageId: null,
    priority: 0,
    due: null,
  });
  for (const step of steps) {
    if (model.done) break;
    handlers.get(step.operation)?.(model, step.pick);
  }
  return model.events;
}

export function itemEventSequence(): fc.Arbitrary<NewHarnessEvent[]> {
  const step = fc.record({
    operation: fc.constantFrom(...operations),
    pick: fc.nat({ max: stageKeys.length - 1 }),
  });
  return fc
    .tuple(fc.nat({ max: stageKeys.length - 1 }), fc.array(step, { maxLength: 40 }))
    .map(([start, steps]) => walkSteps(start, steps));
}
