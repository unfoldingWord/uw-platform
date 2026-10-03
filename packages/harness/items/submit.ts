import type {
  EventEvidence,
  ExitGate,
  Harness,
  HarnessEvent,
  ItemState,
  Stage,
  submitToGateResultSchema,
} from '@uw/contracts';
import { allowed } from '../access.ts';
import type { Caller } from '../caller.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import { factsFailure } from '../gates/facts-failure.ts';
import { riskDeclarationOf } from '../github/declaration.ts';
import { branchFor, fullSha, sameRepository } from '../github/identifiers.ts';
import type { Ports, PullRequestFacts, PullRequestRef, StoreTransaction } from '../ports.ts';
import { noteGateMet } from '../runs/gates-met.ts';
import { runValidators } from '../validators/registry.ts';
import { attachedPageIds } from '../validators/learning-attached.ts';
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
import { applyDeclaration, carryForward, floorFromPaths } from '../risk/derive.ts';
import { pausedRefusal } from './paused.ts';
import { heldStanding } from './run-steps.ts';
import { actingPrincipal, isRefusal, recordDelegationRequired } from '../delegations/acting.ts';
import { pathsComparedAt } from '../github/changed-files.ts';
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

type Command = {
  readonly caller: Caller;
  readonly input: SubmitInput;
  readonly facts: PullRequestFacts | null;
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

function samePullRequest(facts: PullRequestFacts, change: SubmitChange): boolean {
  const { repo, number } = change.pullRequest;
  return sameRepository(facts.ref.repo, repo) && facts.ref.number === number;
}

function pathsAtHead(
  facts: PullRequestFacts | null,
  change: SubmitChange,
  item: ItemState,
): readonly string[] | null {
  if (facts === null || !samePullRequest(facts, change)) return null;
  if (facts.headRepo === null || !sameRepository(facts.headRepo, change.pullRequest.repo)) {
    return null;
  }
  if (facts.headRef !== branchFor(item.itemId) || fullSha(facts.head) !== change.head) return null;
  return pathsComparedAt(facts, change.head);
}

function baseOf(facts: PullRequestFacts): EventEvidence['risk_derived']['base'] {
  const sha = fullSha(facts.base);
  return sha === null ? null : { sha, ref: facts.baseRef };
}

function riskDraft(command: Command, item: ItemState): readonly EventDraft[] {
  const { change } = command.input;
  if (change === null || command.facts === null) return [];
  const paths = pathsAtHead(command.facts, change, item);
  if (paths === null) return [];
  const fresh = floorFromPaths(paths);
  const floor = carryForward(fresh, { tier: item.riskTier, domains: item.riskDomains });
  const declaration = riskDeclarationOf(command.facts.declaration);
  const result = applyDeclaration(floor, declaration);
  return [
    draft('risk_derived', {
      paths: [...paths],
      declaration,
      floorDomains: [...floor.domains],
      riskTier: result.ok ? result.tier : floor.tier,
      riskDomains: [...result.domains],
      refusal: result.ok ? null : result.reason,
      head: change.head,
      repository: change.pullRequest.repo,
      base: baseOf(command.facts),
    }),
  ];
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

async function submitIn(
  ports: SubmitPorts,
  tx: StoreTransaction,
  command: Command,
): Promise<KernelOutcome<Submitted>> {
  const { caller, input, at } = command;
  const item = await tx.harnessItems.read.lock(input.itemId);
  if (item === null) return refused('item_not_found', { itemId: input.itemId });
  const harness = await tx.harnesses.read.byId(item.harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId: item.harnessId });
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  const stage = stages.find((entry) => entry.key === item.stageKey);
  if (stage === undefined) return refused('stage_not_found', { stage: item.stageKey });
  const halted = pausedRefusal(caller, harness, stage);
  if (halted !== null) return halted;
  const context = recordContext(ports, caller, at);
  const denied = await standingRefusal(tx, ports, { caller, item, harness, stage, context });
  if (denied !== null) return denied;
  const mismatch = repositoryRefusal(input, harness);
  if (mismatch !== null) return mismatch;
  const exit = resolveExit(stages, stage, input.to);
  if (exit === null) return refused('transition_not_allowed', { from: stage.key, to: input.to });
  if (unattendedLoop(exit, caller.actor, item.delegationId)) {
    return recordDelegationRequired(tx, context, item.itemId, stage.key);
  }
  const handler = gates.get(stage.exitGate);
  if (handler === undefined) return refused('malformed_command', { exitGate: stage.exitGate });
  const decision = await handler(tx, {
    item,
    stage,
    exit,
    tweak: isOccasionalTweak(exit),
    input,
  });
  await noteGateMet(tx, item, stage.key);
  const recorded = await recordItemEvents(tx, context, item.itemId, [
    ...riskDraft(command, item),
    ...decision.drafts,
  ]);
  return accepted({ item: recorded.item, result: decision.result, failures: decision.failures });
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
  const command = { caller, input: normalised, facts: read.facts, at: ports.clock.now() };
  return ports.store.transaction((tx) => submitIn(ports, tx, command));
}
