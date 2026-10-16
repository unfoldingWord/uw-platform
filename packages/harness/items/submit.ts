import {
  eventEvidenceSchemas,
  type ExitGate,
  type Harness,
  type HarnessEvent,
  type ItemState,
  type Stage,
  type submitToGateResultSchema,
} from '@uw/contracts';
import { allowed } from '../access.ts';
import type { Caller } from '../caller.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import { factsFailure } from '../gates/facts-failure.ts';
import { fullSha, sameRepository } from '../github/identifiers.ts';
import type { Ports, PullRequestFacts, PullRequestRef, StoreTransaction } from '../ports.ts';
import { endRunDrafts } from '../runs/ends.ts';
import { noteGateMet } from '../runs/gates-met.ts';
import { runValidators } from '../validators/registry.ts';
import type { Attachment } from '../validators/context.ts';
import { attachedPageIds } from '../validators/learning-attached.ts';
import { attachWithin, isAttachRefusal } from './learning.ts';
import { riskDraft } from './submit-risk.ts';
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
import { pausedRefusal } from './paused.ts';
import { heldStanding } from './run-steps.ts';
import { actingPrincipal, isRefusal, recordDelegationRequired } from '../delegations/acting.ts';
import {
  delegatedPreRead,
  delegationRequiredAtShip,
  shipUnderDelegation,
  type DelegatedRead,
} from '../gates/delegated-ship.ts';
import {
  exitDrafts,
  isOccasionalTweak,
  resolveExit,
  unattendedLoop,
  type Exit,
} from './transitions.ts';

type SubmitToGateResult = (typeof submitToGateResultSchema.options)[number];
type SubmitPorts = Pick<Ports, 'clock' | 'githubFacts' | 'grants' | 'ids' | 'store'>;

export type SubmitChange = { readonly pullRequest: PullRequestRef; readonly head: string };

export type SubmitInput = {
  readonly itemId: string;
  readonly to: string | null;
  readonly evidence: HarnessEvent['evidence'];
  readonly change: SubmitChange | null;
  readonly attach?: readonly string[];
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
  readonly attaching: readonly Attachment[];
};

type Command = {
  readonly caller: Caller;
  readonly input: SubmitInput;
  readonly facts: PullRequestFacts | null;
  readonly lent: DelegatedRead | null;
  readonly at: Date;
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

function withNormalisedHead(input: SubmitInput): SubmitInput | null {
  if (input.change === null) return input;
  const given = input.change.head;
  const head = given === given.trim() ? fullSha(given) : null;
  return head === null
    ? null
    : { ...input, change: { pullRequest: input.change.pullRequest, head } };
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
  const { attaching } = submission;
  const events = await readAllEvents(tx, item.harnessId, item.itemId);
  const facts = await tx.pages.read.facts(attachedPageIds(events, attaching));
  const pages = new Map(facts.map((page) => [page.id, page]));
  const failures = runValidators(stage.validators, { item, events, pages, attaching });
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
  readonly harness: Harness;
  readonly stage: Stage;
  readonly context: RecordContext;
};

async function notHolderRefusal(
  tx: StoreTransaction,
  ports: SubmitPorts,
  { caller, item, harness, context }: Standing,
): Promise<Refused> {
  const acting = await actingPrincipal(ports, tx, { caller, harness, delegationId: null, context });
  const permitted = !isRefusal(acting) && allowed(acting, 'write', harness, context.at);
  return permitted ? refused('not_holder', { itemId: item.itemId }) : notPermitted(item);
}

async function standingRefusal(
  tx: StoreTransaction,
  ports: SubmitPorts,
  standing: Standing,
): Promise<Refused | null> {
  const { caller, item, context } = standing;
  const holds = await holdsClaim(tx, item, caller.actor, {
    itemId: item.itemId,
    delegationId: item.delegationId,
  });
  if (!holds) return notHolderRefusal(tx, ports, standing);
  const held = await heldStanding(tx, ports, context, { caller, item });
  if (held?.reason === 'delegation_required') {
    return recordDelegationRequired(tx, context, item.itemId, standing.stage.key);
  }
  if (held !== null) return held;
  if (leaseLapsed(item, context.at)) {
    await expireLapsedLease(tx, context, item);
    return refused('lease_expired', { itemId: item.itemId, leaseExpiresAt: item.leaseExpiresAt });
  }
  return null;
}

function notPermitted(item: ItemState): Refused {
  return refused('not_permitted', { harnessId: item.harnessId });
}

function repositoryRefusal(input: SubmitInput, harness: Harness): Refused | null {
  if (input.change === null || sameRepository(input.change.pullRequest.repo, harness.repository)) {
    return null;
  }
  return refused('not_permitted', { why: 'repository_mismatch' });
}

async function attachments(
  tx: StoreTransaction,
  { item, harness }: { readonly item: ItemState; readonly harness: Harness },
  pageIds: readonly string[],
): Promise<readonly Attachment[] | Refused> {
  if (pageIds.length === 0) return [];
  const earlier = new Set(attachedPageIds(await readAllEvents(tx, item.harnessId, item.itemId)));
  const attaching: Attachment[] = [];
  for (const pageId of pageIds.filter((id) => !earlier.has(id))) {
    const attached = await attachWithin(tx, harness, pageId);
    if (isAttachRefusal(attached)) return attached;
    attaching.push(eventEvidenceSchemas.learning_attached.parse(attached.evidence));
  }
  return attaching;
}

type SubmitScene = {
  readonly item: ItemState;
  readonly harness: Harness;
  readonly stages: readonly Stage[];
  readonly stage: Stage;
};

async function submitScene(tx: StoreTransaction, itemId: string): Promise<SubmitScene | Refused> {
  const item = await tx.harnessItems.read.lock(itemId);
  if (item === null) return refused('item_not_found', { itemId });
  const harness = await tx.harnesses.read.byId(item.harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId: item.harnessId });
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  const stage = stages.find((entry) => entry.key === item.stageKey);
  if (stage === undefined) return refused('stage_not_found', { stage: item.stageKey });
  return { item, harness, stages, stage };
}

async function submitGuards(
  tx: StoreTransaction,
  ports: SubmitPorts,
  standing: Standing,
  input: SubmitInput,
): Promise<Refused | null> {
  const { caller, harness, stage } = standing;
  return (
    pausedRefusal(caller, harness, stage) ??
    (await standingRefusal(tx, ports, standing)) ??
    (await delegationRequiredAtShip(tx, standing)) ??
    repositoryRefusal(input, harness)
  );
}

async function submitIn(
  ports: SubmitPorts,
  tx: StoreTransaction,
  command: Command,
): Promise<KernelOutcome<Submitted>> {
  const { caller, input, at } = command;
  const scene = await submitScene(tx, input.itemId);
  if ('status' in scene) return scene;
  const { item, harness, stages, stage } = scene;
  const context = recordContext(ports, caller, at);
  const denied = await submitGuards(tx, ports, { caller, item, harness, stage, context }, input);
  if (denied !== null) return denied;
  const attaching = await attachments(tx, { item, harness }, input.attach ?? []);
  if ('status' in attaching) return attaching;
  const exit = resolveExit(stages, stage, input.to);
  if (exit === null) return refused('transition_not_allowed', { from: stage.key, to: input.to });
  if (unattendedLoop(exit, caller.actor, item.delegationId)) {
    return recordDelegationRequired(tx, context, item.itemId, stage.key);
  }
  const handler = gates.get(stage.exitGate);
  if (handler === undefined) return refused('malformed_command', { exitGate: stage.exitGate });
  const tweak = isOccasionalTweak(exit);
  const decision = await handler(tx, { item, stage, exit, tweak, input, attaching });
  const recording = { command, scene, context, decision, attaching };
  const recorded = await recordSubmission(tx, recording);
  return accepted(await delegatedAfter(ports, tx, { ...recording, recorded }));
}

type Recording = {
  readonly command: Command;
  readonly scene: SubmitScene;
  readonly context: RecordContext;
  readonly decision: Decision;
  readonly attaching: readonly Attachment[];
};

async function recordSubmission(tx: StoreTransaction, recording: Recording): Promise<ItemState> {
  const { command, scene, context, decision, attaching } = recording;
  const { item, stage } = scene;
  const ending = await submittedRun(tx, { item, stage, decision, at: command.at });
  const recorded = await recordItemEvents(tx, context, item.itemId, [
    ...riskDraft(command.facts, command.input.change, item),
    ...attaching.map((attachment) => draft('learning_attached', attachment)),
    ...decision.drafts,
    ...ending,
  ]);
  return recorded.item;
}

async function delegatedAfter(
  ports: SubmitPorts,
  tx: StoreTransaction,
  after: Recording & { readonly recorded: ItemState },
): Promise<Submitted> {
  const { command, scene, context, decision, recorded } = after;
  const { delegationId } = scene.item;
  const read = command.lent;
  const lent = { ...scene, item: recorded, caller: command.caller, context };
  const shipped =
    read === null || delegationId === null
      ? null
      : await shipUnderDelegation(ports, tx, { ...lent, delegationId, read });
  const failures = shipped?.failures ?? decision.failures;
  return { item: shipped?.item ?? recorded, result: decision.result, failures };
}

type Outcome = {
  readonly item: ItemState;
  readonly stage: Stage;
  readonly decision: Decision;
  readonly at: Date;
};

async function submittedRun(
  tx: StoreTransaction,
  { item, stage, decision, at }: Outcome,
): Promise<readonly EventDraft[]> {
  await noteGateMet(tx, item, stage.key);
  if (decision.result === 'checks_failed') return [];
  const ending = await endRunDrafts(tx, item, { outcome: 'completed', result: 'submitted', at });
  return ending.drafts;
}

type FactsRead = { readonly facts: PullRequestFacts | null } | { readonly refusal: Refused };

async function harnessRepository(ports: SubmitPorts, itemId: string): Promise<string | null> {
  return ports.store.transaction(async (tx) => {
    const item = await tx.harnessItems.read.byId(itemId);
    const harness = item === null ? null : await tx.harnesses.read.byId(item.harnessId);
    return harness?.repository ?? null;
  });
}

async function readFacts(ports: SubmitPorts, input: SubmitInput): Promise<FactsRead> {
  const { change } = input;
  if (change === null) return { facts: null };
  const repository = await harnessRepository(ports, input.itemId);
  if (!sameRepository(change.pullRequest.repo, repository)) return { facts: null };
  try {
    return { facts: await ports.githubFacts.pullRequest(change.pullRequest) };
  } catch (error) {
    return { refusal: factsFailure(error) };
  }
}

export async function submit(
  ports: SubmitPorts,
  caller: Caller,
  input: SubmitInput,
): Promise<KernelOutcome<Submitted>> {
  const normalised = withNormalisedHead(input);
  if (normalised === null) {
    return refused('malformed_command', { head: input.change?.head ?? null });
  }
  const read = await readFacts(ports, normalised);
  if ('refusal' in read) return read.refusal;
  const lent = await delegatedPreRead(ports, caller, normalised.itemId);
  if (lent !== null && 'status' in lent) return lent;
  const command = { caller, input: normalised, facts: read.facts, lent, at: ports.clock.now() };
  return ports.store.transaction((tx) => submitIn(ports, tx, command));
}
