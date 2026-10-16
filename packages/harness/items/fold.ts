import {
  eventEvidenceSchemas,
  identitySchema,
  type EventName,
  type HarnessEvent,
  type ItemState,
  type NewHarnessEvent,
} from '@uw/contracts';
import { carryForward } from '../risk/derive.ts';

export type FoldableEvent = NewHarnessEvent | HarnessEvent;

export class ReplayError extends Error {
  readonly eventId: string;

  constructor(message: string, eventId: string) {
    super(message);
    this.name = 'ReplayError';
    this.eventId = eventId;
  }
}

type Step = (state: ItemState, event: FoldableEvent) => ItemState;

const releasedFields = {
  holder: null,
  claimantKind: null,
  delegationId: null,
  leaseExpiresAt: null,
} as const;

function created(event: FoldableEvent): ItemState {
  const evidence = eventEvidenceSchemas.item_created.parse(event.evidence);
  if (event.itemId === null) throw new ReplayError('item_created names no item', event.eventId);
  return {
    itemId: event.itemId,
    harnessId: event.harnessId,
    stageKey: evidence.stage,
    title: evidence.title,
    pageId: evidence.pageId,
    priority: evidence.priority,
    due: evidence.due,
    ...releasedFields,
    gateStatus: 'working',
    gateTarget: null,
    branchState: 'none',
    expectedHead: evidence.expectedHead,
    riskTier: null,
    riskDomains: [],
    pullRequest: evidence.pullRequest,
    issue: evidence.issue,
    zulipTopic: null,
    epic: evidence.epic,
    blockedBy: evidence.blockedBy,
  };
}

function claim(state: ItemState, event: FoldableEvent): ItemState {
  const evidence = eventEvidenceSchemas.item_claimed.parse(event.evidence);
  return {
    ...state,
    holder: evidence.holder,
    claimantKind: evidence.claimantKind,
    delegationId: evidence.delegationId,
    leaseExpiresAt: evidence.leaseExpiresAt,
  };
}

function release(state: ItemState): ItemState {
  return { ...state, ...releasedFields };
}

function renewLease(state: ItemState, event: FoldableEvent): ItemState {
  const evidence =
    event.name === 'lease_renewed'
      ? eventEvidenceSchemas.lease_renewed.parse(event.evidence)
      : eventEvidenceSchemas.run_step_recorded.parse(event.evidence);
  return { ...state, leaseExpiresAt: evidence.leaseExpiresAt };
}

function abandonBranch(state: ItemState): ItemState {
  return { ...state, branchState: 'abandoned' };
}

function adoptBranch(state: ItemState, event: FoldableEvent): ItemState {
  const { head } = eventEvidenceSchemas.branch_adopted.parse(event.evidence);
  return { ...state, branchState: 'active', expectedHead: head ?? state.expectedHead };
}

function submit(state: ItemState, event: FoldableEvent): ItemState {
  const evidence = eventEvidenceSchemas.submitted_to_gate.parse(event.evidence);
  const head =
    evidence.expectedHead === null
      ? {}
      : { expectedHead: evidence.expectedHead, branchState: 'active' as const };
  const pullRequest = evidence.pullRequest === null ? {} : { pullRequest: evidence.pullRequest };
  const park =
    evidence.result === 'parked'
      ? { ...releasedFields, gateStatus: 'parked' as const, gateTarget: evidence.to }
      : {};
  return { ...state, ...head, ...pullRequest, ...park };
}

function failChecks(state: ItemState): ItemState {
  return { ...state, gateStatus: 'checks_failed' };
}

function advance(state: ItemState, event: FoldableEvent): ItemState {
  const evidence = eventEvidenceSchemas.stage_advanced.parse(event.evidence);
  const settled = { ...state, ...releasedFields, gateTarget: null };
  if (evidence.to === null) return { ...settled, gateStatus: 'done' };
  return { ...settled, stageKey: evidence.to, gateStatus: 'working' };
}

function takeLoopEdge(state: ItemState, event: FoldableEvent): ItemState {
  const evidence = eventEvidenceSchemas.loop_edge_taken.parse(event.evidence);
  return {
    ...state,
    ...releasedFields,
    stageKey: evidence.to,
    gateStatus: 'working',
    gateTarget: null,
  };
}

function reject(state: ItemState): ItemState {
  return { ...state, gateStatus: 'working', gateTarget: null };
}

function takeOver(state: ItemState, event: FoldableEvent): ItemState {
  const evidence = eventEvidenceSchemas.gate_taken_over.parse(event.evidence);
  return {
    ...state,
    holder: evidence.holder,
    claimantKind: 'person',
    delegationId: null,
    leaseExpiresAt: null,
    gateStatus: 'working',
    gateTarget: null,
  };
}

function handToPerson(state: ItemState, event: FoldableEvent): ItemState {
  const evidence = eventEvidenceSchemas.handed_to_person.parse(event.evidence);
  return {
    ...state,
    holder: identitySchema.parse(`human:${evidence.personId}`),
    claimantKind: 'person',
    delegationId: null,
    leaseExpiresAt: null,
  };
}

function reorder(state: ItemState, event: FoldableEvent): ItemState {
  const evidence = eventEvidenceSchemas.item_reordered.parse(event.evidence);
  return { ...state, priority: evidence.priority };
}

function deriveRisk(state: ItemState, event: FoldableEvent): ItemState {
  const evidence = eventEvidenceSchemas.risk_derived.parse(event.evidence);
  const held = { tier: state.riskTier, domains: state.riskDomains };
  const floored = carryForward(held, { tier: evidence.riskTier, domains: evidence.riskDomains });
  return { ...state, riskTier: floored.tier, riskDomains: [...floored.domains] };
}

function linkTopic(state: ItemState, event: FoldableEvent): ItemState {
  const evidence = eventEvidenceSchemas.zulip_topic_linked.parse(event.evidence);
  return { ...state, zulipTopic: evidence.topic };
}

const steps: ReadonlyMap<EventName, Step> = new Map<EventName, Step>([
  ['item_claimed', claim],
  ['item_released', release],
  ['lease_expired', release],
  ['lease_renewed', renewLease],
  ['run_step_recorded', renewLease],
  ['branch_abandoned', abandonBranch],
  ['branch_adopted', adoptBranch],
  ['submitted_to_gate', submit],
  ['checks_failed', failChecks],
  ['stage_advanced', advance],
  ['loop_edge_taken', takeLoopEdge],
  ['gate_rejected', reject],
  ['gate_taken_over', takeOver],
  ['risk_derived', deriveRisk],
  ['item_reordered', reorder],
  ['zulip_topic_linked', linkTopic],
  ['handed_to_person', handToPerson],
]);

export const unchangedNames: ReadonlySet<EventName> = new Set<EventName>([
  'review_verdict_recorded',
  'shadow_verdict',
  'shadow_lifted',
  'freeze_changed',
  'epic_enqueued',
  'done_when_missing',
  'finding_refuted',
  'delegated_exit_claimed',
  'premise_held',
  'label_removed',
  'run_started',
  'run_failed',
  'run_hibernated',
  'run_resumed',
  'run_stopped',
  'run_completed',
  'run_prompted',
  'checks_passed',
  'gate_approved',
  'gate_overridden',
  'gate_refused_to_agent',
  'ship_refused',
  'connector_succeeded',
  'connector_refused',
  'delegated_merge',
  'delegation_granted',
  'delegation_revoked',
  'delegation_lapsed',
  'delegation_required',
  'stage_edit_refused',
  'stage_edited',
  'stage_removed',
  'template_activated',
  'harness_paused',
  'harness_resumed',
  'hosted_builder_set',
  'fix_claimed',
  'fix_claim_set',
  'learning_attached',
  'nothing_learned',
  'comment_recorded',
  'breaker_holding',
  'breaker_pausing',
  'breaker_open',
  'persona_activation_failed',
  'persona_activated',
  'measurement_recorded',
]);

export const steppedNames: readonly EventName[] = [...steps.keys()];

function ownedBy(state: ItemState, event: FoldableEvent): boolean {
  return event.itemId === state.itemId && event.harnessId === state.harnessId;
}

export function foldItem(state: ItemState | null, event: FoldableEvent): ItemState {
  if (event.name === 'item_created') {
    if (state !== null) throw new ReplayError('item_created twice', event.eventId);
    return created(event);
  }
  if (state === null) throw new ReplayError(`${event.name} before item_created`, event.eventId);
  if (!ownedBy(state, event))
    throw new ReplayError(`${event.name} for another item`, event.eventId);
  const step = steps.get(event.name);
  return step === undefined ? state : step(state, event);
}

export function replay(events: readonly FoldableEvent[]): ItemState | null {
  return events.reduce<ItemState | null>(foldItem, null);
}
