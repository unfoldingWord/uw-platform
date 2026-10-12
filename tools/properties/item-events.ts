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
const runId = '00000000-0000-4000-8000-0000000000f1';
const agent = 'agent:builder';
const repo = 'unfoldingWord/uw-platform';
const person = 'human:00000000-0000-4000-8000-000000000001';
const epoch = Date.parse('2026-10-01T09:00:00.000Z');
const minute = 60_000;

const operations = [
  'claim',
  'release',
  'renew',
  'expire',
  'runStep',
  'submitParked',
  'submitAdvanced',
  'checksFailed',
  'reject',
  'takeOver',
  'loopEdge',
  'riskDerived',
  'abandonBranch',
  'adoptBranch',
  'reorder',
  'irrelevant',
  'runEvent',
  'linkTopic',
  'handOff',
] as const;

type Operation = (typeof operations)[number];
type Step = { readonly operation: Operation; readonly pick: number };

type Expected = {
  stageKey: string;
  priority: number;
  holder: string | null;
  claimantKind: 'agent' | 'person' | null;
  delegationId: null;
  leaseExpiresAt: string | null;
  gateStatus: 'working' | 'parked' | 'checks_failed' | 'done';
  gateTarget: string | null;
  branchState: 'none' | 'active' | 'abandoned';
  expectedHead: string | null;
  pullRequest: { repo: string; number: number } | null;
  riskTier: 'low' | 'standard' | 'high' | null;
  riskDomains: string[];
  zulipTopic: string | null;
};

export type ItemSequence = { readonly events: NewHarnessEvent[]; readonly expected: Expected };

type Model = {
  stage: number;
  count: number;
  expected: Expected;
  readonly events: NewHarnessEvent[];
};
type Evidence = Record<string, unknown>;
type Handler = (model: Model, pick: number) => boolean;

function emit(model: Model, name: EventName, evidence: Evidence): void {
  model.count += 1;
  model.events.push(
    newEventSchema.parse({
      eventId: `00000000-0000-4000-8000-${model.count.toString(16).padStart(12, '0')}`,
      harnessId,
      itemId,
      name,
      at: new Date(epoch + model.count * minute).toISOString(),
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

function held(model: Model): boolean {
  return model.expected.holder !== null;
}

function leased(model: Model): boolean {
  return model.expected.leaseExpiresAt !== null;
}

function release(model: Model): void {
  model.expected.holder = null;
  model.expected.claimantKind = null;
  model.expected.leaseExpiresAt = null;
}

function submit(model: Model, result: string, to: string | null, pick: number): void {
  const head = model.count.toString(16).padStart(40, '0');
  const pullRequest = pick % 2 === 0 ? { repo, number: pick + 1 } : null;
  emit(model, 'submitted_to_gate', {
    stage: stageKey(model.stage),
    result,
    to,
    expectedHead: head,
    pullRequest,
    evidence: {},
  });
  model.expected.expectedHead = head;
  model.expected.branchState = 'active';
  if (pullRequest !== null) model.expected.pullRequest = pullRequest;
}

function claim(model: Model): boolean {
  if (held(model) || model.expected.gateStatus === 'parked') return false;
  const leaseExpiresAt = leaseAfter(model);
  emit(model, 'item_claimed', {
    holder: agent,
    claimantKind: 'agent',
    delegationId: null,
    leaseExpiresAt,
  });
  Object.assign(model.expected, { holder: agent, claimantKind: 'agent', leaseExpiresAt });
  return true;
}

function releaseHolder(model: Model): boolean {
  const holder = model.expected.holder;
  if (holder === null) return false;
  emit(model, 'item_released', { holder });
  release(model);
  return true;
}

function renew(model: Model): boolean {
  if (!leased(model)) return false;
  const leaseExpiresAt = leaseAfter(model);
  emit(model, 'lease_renewed', { leaseExpiresAt });
  model.expected.leaseExpiresAt = leaseExpiresAt;
  return true;
}

function runStep(model: Model): boolean {
  if (!leased(model)) return false;
  const leaseExpiresAt = leaseAfter(model);
  emit(model, 'run_step_recorded', {
    runId,
    step: 'work',
    tokensIn: 1,
    tokensOut: 1,
    costBasis: 'metered',
    leaseExpiresAt,
  });
  model.expected.leaseExpiresAt = leaseExpiresAt;
  return true;
}

function expire(model: Model): boolean {
  const { holder, leaseExpiresAt } = model.expected;
  if (holder === null || leaseExpiresAt === null) return false;
  emit(model, 'lease_expired', { holder, leaseExpiresAt });
  release(model);
  return true;
}

function submitParked(model: Model, pick: number): boolean {
  if (!held(model)) return false;
  const to = stageKey(pick % stageKeys.length);
  submit(model, 'parked', to, pick);
  release(model);
  Object.assign(model.expected, { gateStatus: 'parked', gateTarget: to });
  return true;
}

function submitAdvanced(model: Model, pick: number): boolean {
  if (!held(model)) return false;
  const last = model.stage === stageKeys.length - 1;
  const to = last ? null : stageKey(model.stage + 1);
  submit(model, 'advanced', to, pick);
  emit(model, 'stage_advanced', { from: stageKey(model.stage), to });
  release(model);
  model.expected.gateTarget = null;
  model.expected.gateStatus = last ? 'done' : 'working';
  model.stage = last ? model.stage : model.stage + 1;
  model.expected.stageKey = stageKey(model.stage);
  return true;
}

function checksFailed(model: Model): boolean {
  if (!held(model)) return false;
  emit(model, 'checks_failed', { stage: stageKey(model.stage), failures: ['a check failed'] });
  model.expected.gateStatus = 'checks_failed';
  return true;
}

function reject(model: Model): boolean {
  if (model.expected.gateStatus !== 'parked') return false;
  emit(model, 'gate_rejected', { decisionId, stage: stageKey(model.stage), findings: [] });
  Object.assign(model.expected, { gateStatus: 'working', gateTarget: null });
  return true;
}

function takeOver(model: Model): boolean {
  if (model.expected.gateStatus !== 'parked') return false;
  emit(model, 'gate_taken_over', { decisionId, stage: stageKey(model.stage), holder: person });
  Object.assign(model.expected, {
    holder: person,
    claimantKind: 'person',
    leaseExpiresAt: null,
    gateStatus: 'working',
    gateTarget: null,
  });
  return true;
}

function handOff(model: Model, pick: number): boolean {
  if (model.expected.gateStatus === 'parked') return false;
  const personId = '00000000-0000-4000-8000-000000000001';
  emit(model, 'handed_to_person', { personId, why: 'review_rounds_exhausted', rounds: 3 + pick });
  Object.assign(model.expected, { holder: person, claimantKind: 'person', leaseExpiresAt: null });
  return true;
}

function loopEdge(model: Model, pick: number): boolean {
  if (held(model)) return false;
  const to = pick % stageKeys.length;
  emit(model, 'loop_edge_taken', { from: stageKey(model.stage), to: stageKey(to) });
  model.stage = to;
  Object.assign(model.expected, {
    stageKey: stageKey(to),
    gateStatus: 'working',
    gateTarget: null,
  });
  return true;
}

const tiers = ['low', 'standard', 'high', null] as const;
const tierOrder = ['low', 'standard', 'high'];
const domainOrder = ['ledger', 'acl', 'infra', 'migration'];
const domainSets = [[], ['acl'], ['ledger', 'migration']];

function higherTier(left: string | null, right: string | null): string | null {
  return tierOrder.indexOf(left ?? '') >= tierOrder.indexOf(right ?? '') ? left : right;
}

function riskDerived(model: Model, pick: number): boolean {
  const riskTier = tiers[pick % tiers.length] ?? null;
  const riskDomains = domainSets[pick % domainSets.length] ?? [];
  emit(model, 'risk_derived', {
    paths: ['src/index.ts'],
    declaration: null,
    floorDomains: [],
    riskTier,
    riskDomains,
    refusal: null,
  });
  const held = model.expected;
  const union = domainOrder.filter(
    (domain) => held.riskDomains.includes(domain) || riskDomains.includes(domain),
  );
  Object.assign(model.expected, {
    riskTier: higherTier(held.riskTier, riskTier),
    riskDomains: union,
  });
  return true;
}

function abandonBranch(model: Model): boolean {
  emit(model, 'branch_abandoned', { head: null });
  model.expected.branchState = 'abandoned';
  return true;
}

function adoptBranch(model: Model): boolean {
  emit(model, 'branch_adopted', { head: null });
  model.expected.branchState = 'active';
  return true;
}

function reorder(model: Model, pick: number): boolean {
  const priority = (pick % 7) * 10;
  emit(model, 'item_reordered', { priority, before: pick % 2 === 0 ? null : itemId });
  model.expected.priority = priority;
  return true;
}

const comment = {
  source: 'zulip',
  messageId: 1,
  topic: 'software/uw-platform#1',
  personId: null,
  email: 'ana@example.org',
  text: 'approve',
  truncated: false,
};

function irrelevant(model: Model, pick: number): boolean {
  if (pick % 2 === 0) emit(model, 'comment_recorded', comment);
  else emit(model, 'checks_passed', { stage: stageKey(model.stage), validators: [] });
  return true;
}

const hibernated = { runId, why: 'paused' };
const runEvents: readonly (readonly [EventName, Evidence])[] = [
  [
    'run_started',
    {
      runId,
      persona: agent,
      runShape: 'workflow-run',
      engine: 'claude-messages',
      model: 'claude-sonnet-5',
      delegationId: null,
    },
  ],
  ['run_hibernated', hibernated],
  ['run_resumed', hibernated],
  ['run_prompted', { runId, message: 'Look at the board first.' }],
  ['premise_held', { runId, reason: 'the issue was closed upstream' }],
  ['run_stopped', { runId, why: 'stopped_by_person' }],
  ['run_failed', { runId, step: 'work', why: 'retries_exhausted', detail: 'RangeError' }],
  ['run_completed', { runId, result: 'submitted', gates: [], review: null }],
];

function linkTopic(model: Model, pick: number): boolean {
  if (model.expected.zulipTopic !== null) return false;
  const topic = `software/item-${pick.toString(16).padStart(8, '0')}`;
  emit(model, 'zulip_topic_linked', { topic });
  model.expected.zulipTopic = topic;
  return true;
}

function runEvent(model: Model, pick: number): boolean {
  const [name, evidence] = runEvents[pick % runEvents.length] ?? runEvents[0] ?? [];
  if (name === undefined || evidence === undefined) return false;
  emit(model, name, evidence);
  return true;
}

const handlers: ReadonlyMap<Operation, Handler> = new Map<Operation, Handler>([
  ['claim', claim],
  ['release', releaseHolder],
  ['renew', renew],
  ['expire', expire],
  ['runStep', runStep],
  ['submitParked', submitParked],
  ['submitAdvanced', submitAdvanced],
  ['checksFailed', checksFailed],
  ['reject', reject],
  ['takeOver', takeOver],
  ['handOff', handOff],
  ['loopEdge', loopEdge],
  ['riskDerived', riskDerived],
  ['abandonBranch', abandonBranch],
  ['adoptBranch', adoptBranch],
  ['reorder', reorder],
  ['irrelevant', irrelevant],
  ['runEvent', runEvent],
  ['linkTopic', linkTopic],
]);

function startModel(start: number): Model {
  const expected: Expected = {
    stageKey: stageKey(start),
    priority: 0,
    holder: null,
    claimantKind: null,
    delegationId: null,
    leaseExpiresAt: null,
    gateStatus: 'working',
    gateTarget: null,
    branchState: 'none',
    expectedHead: null,
    pullRequest: null,
    riskTier: null,
    riskDomains: [],
    zulipTopic: null,
  };
  const model: Model = { stage: start, count: 0, expected, events: [] };
  emit(model, 'item_created', {
    stage: stageKey(start),
    title: 'Item',
    pageId: null,
    priority: 0,
    due: null,
  });
  return model;
}

function walkSteps(start: number, steps: readonly Step[]): ItemSequence {
  const model = startModel(start);
  for (const step of steps) {
    if (model.expected.gateStatus === 'done') break;
    handlers.get(step.operation)?.(model, step.pick);
  }
  return { events: model.events, expected: model.expected };
}

export function itemEventSequence(): fc.Arbitrary<ItemSequence> {
  const step = fc.record({
    operation: fc.constantFrom(...operations),
    pick: fc.nat({ max: 1000 }),
  });
  return fc
    .tuple(fc.nat({ max: stageKeys.length - 1 }), fc.array(step, { maxLength: 40 }))
    .map(([start, steps]) => walkSteps(start, steps));
}
