import type {
  ExitGate,
  HarnessEvent,
  ItemState,
  RiskDeclaration,
  Stage,
  submitToGateResultSchema,
} from '@uw/contracts';
import { allowed } from '../access.ts';
import type { Caller } from '../caller.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, PullRequestRef, StoreTransaction } from '../ports.ts';
import { runValidators } from '../validators/registry.ts';
import { attachedPageIds } from '../validators/learning-attached.ts';
import { withFreshGrants } from './claim.ts';
import { expireLapsedLease, leaseLapsed } from './leases.ts';
import {
  draft,
  readAllEvents,
  recordContext,
  recordItemEvents,
  type EventDraft,
  type RecordContext,
} from './record.ts';
import { holdsClaim } from './release.ts';
import { delegationRefusal } from './run-steps.ts';
import {
  exitDrafts,
  isOccasionalTweak,
  resolveExit,
  unattendedLoop,
  type Exit,
} from './transitions.ts';

type SubmitToGateResult = (typeof submitToGateResultSchema.options)[number];
type SubmitPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type SubmitChange = {
  readonly pullRequest: PullRequestRef;
  readonly head: string;
  readonly paths: readonly string[];
  readonly declaration: RiskDeclaration | null;
};

export type SubmitInput = {
  readonly itemId: string;
  readonly to: string | null;
  readonly evidence: HarnessEvent['evidence'];
  readonly change: SubmitChange | null;
};

export type Submitted = {
  readonly item: ItemState;
  readonly result: SubmitToGateResult;
  readonly failures: readonly string[];
};

type Decision = {
  readonly result: SubmitToGateResult;
  readonly drafts: readonly EventDraft[];
  readonly failures: readonly string[];
};

type Submission = {
  readonly item: ItemState;
  readonly stage: Stage;
  readonly exit: Exit;
  readonly tweak: boolean;
  readonly input: SubmitInput;
};

type GateHandler = (tx: StoreTransaction, submission: Submission) => Promise<Decision>;

function submittedDraft(submission: Submission, result: SubmitToGateResult): EventDraft {
  const { stage, exit, input } = submission;
  return draft('submitted_to_gate', {
    stage: stage.key,
    result,
    to: exit.kind === 'loop' ? exit.to.key : null,
    expectedHead: input.change?.head ?? null,
    pullRequest: input.change?.pullRequest ?? null,
    evidence: input.evidence,
  });
}

async function passThrough(_tx: StoreTransaction, submission: Submission): Promise<Decision> {
  if (submission.tweak) return parkedTweak(submission, []);
  return {
    result: 'advanced',
    drafts: [submittedDraft(submission, 'advanced'), ...exitDrafts(submission.exit)],
    failures: [],
  };
}

async function runChecks(tx: StoreTransaction, submission: Submission): Promise<Decision> {
  const { item, stage } = submission;
  const events = await readAllEvents(tx, item.harnessId, item.itemId);
  const facts = await tx.pages.read.facts(attachedPageIds(events));
  const pages = new Map(facts.map((page) => [page.id, page]));
  const failures = runValidators(stage.validators, { item, events, pages });
  if (failures.length > 0) {
    return {
      result: 'checks_failed',
      drafts: [
        submittedDraft(submission, 'checks_failed'),
        draft('checks_failed', { stage: stage.key, failures: [...failures] }),
      ],
      failures,
    };
  }
  const passed = draft('checks_passed', { stage: stage.key, validators: stage.validators });
  if (submission.tweak) return parkedTweak(submission, [passed]);
  return {
    result: 'advanced',
    drafts: [submittedDraft(submission, 'advanced'), passed, ...exitDrafts(submission.exit)],
    failures: [],
  };
}

function parkedTweak(submission: Submission, after: readonly EventDraft[]): Decision {
  return {
    result: 'parked',
    drafts: [submittedDraft(submission, 'parked'), ...after],
    failures: [],
  };
}

async function park(_tx: StoreTransaction, submission: Submission): Promise<Decision> {
  return { result: 'parked', drafts: [submittedDraft(submission, 'parked')], failures: [] };
}

const gates: ReadonlyMap<ExitGate, GateHandler> = new Map<ExitGate, GateHandler>([
  ['none', passThrough],
  ['checks', runChecks],
  ['human_approval', park],
]);

type Standing = {
  readonly caller: Caller;
  readonly item: ItemState;
  readonly context: RecordContext;
  readonly permitted: boolean;
};

async function standingRefusal(
  tx: StoreTransaction,
  ports: SubmitPorts,
  { caller, item, context, permitted }: Standing,
): Promise<Refused | null> {
  const holds = await holdsClaim(tx, item, caller.actor, {
    itemId: item.itemId,
    delegationId: item.delegationId,
  });
  if (!holds) {
    return permitted ? refused('not_holder', { itemId: item.itemId }) : notPermitted(item);
  }
  const lapsed = await delegationRefusal(tx, ports, context, item);
  if (lapsed !== null) return lapsed;
  if (leaseLapsed(item, context.at)) {
    await expireLapsedLease(tx, context, item);
    return refused('lease_expired', { itemId: item.itemId, leaseExpiresAt: item.leaseExpiresAt });
  }
  return permitted ? null : notPermitted(item);
}

function notPermitted(item: ItemState): Refused {
  return refused('not_permitted', { harnessId: item.harnessId });
}

async function submitIn(
  ports: SubmitPorts,
  tx: StoreTransaction,
  caller: Caller,
  input: SubmitInput,
  at: Date,
): Promise<KernelOutcome<Submitted>> {
  const item = await tx.harnessItems.read.lock(input.itemId);
  if (item === null) return refused('item_not_found', { itemId: input.itemId });
  const harness = await tx.harnesses.read.byId(item.harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId: item.harnessId });
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  const stage = stages.find((entry) => entry.key === item.stageKey);
  if (stage === undefined) return refused('stage_not_found', { stage: item.stageKey });
  const fresh = await withFreshGrants(ports, tx, caller.actor, at);
  const context = recordContext(ports, caller, at);
  const permitted = allowed(fresh, 'write', harness, at);
  const denied = await standingRefusal(tx, ports, { caller, item, context, permitted });
  if (denied !== null) return denied;
  const exit = resolveExit(stages, stage, input.to);
  if (exit === null) return refused('transition_not_allowed', { from: stage.key, to: input.to });
  if (unattendedLoop(exit, caller.actor, item.delegationId)) {
    await recordItemEvents(tx, context, item.itemId, [
      draft('delegation_required', { stage: stage.key }),
    ]);
    return refused('delegation_required', { stage: stage.key });
  }
  const handler = gates.get(stage.exitGate);
  if (handler === undefined) return refused('malformed_command', { exitGate: stage.exitGate });
  const decision = await handler(tx, {
    item,
    stage,
    exit,
    tweak: isOccasionalTweak(stages, exit),
    input,
  });
  const recorded = await recordItemEvents(tx, context, item.itemId, decision.drafts);
  return accepted({ item: recorded.item, result: decision.result, failures: decision.failures });
}

export function submit(
  ports: SubmitPorts,
  caller: Caller,
  input: SubmitInput,
): Promise<KernelOutcome<Submitted>> {
  const at = ports.clock.now();
  return ports.store.transaction((tx) => submitIn(ports, tx, caller, input, at));
}
