import {
  modelIdSchema,
  providerIdSchema,
  type ReadFinding,
  type ReviewFinding,
  type ReviewRecord,
  type ReviewVerdict,
} from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { engineDescriptor } from '../engines.ts';
import { fullSha, normalisedIdentifier } from '../github/identifiers.ts';
import { reviewBody } from '../github/review-body.ts';
import { reviewerOf } from '../github/reviewers.ts';
import { recordShadowVerdicts } from '../gates/shadow.ts';
import { OVER_REVIEW_BUDGET } from '../items/held-for-person.ts';
import { draft, readAllEvents } from '../items/record.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type {
  Ports,
  PullRequestFacts,
  PullRequestRef,
  ReviewFact,
  ReviewRequest,
  RunRow,
} from '../ports.ts';
import { isFailureDetail } from './evidence-rules.ts';
import { complete, completeAfter, fail, type TrailingDrafts } from './lifecycle.ts';
import { roundsAfter } from './rounds.ts';
import { runScene } from './scene.ts';
import type { RunScene } from './types.ts';
import { postedVerdict, weighedFindings } from './weights.ts';

type ReviewPorts = Pick<Ports, 'clock' | 'connectors' | 'githubFacts' | 'grants' | 'ids' | 'store'>;

export type ReviewDiff =
  | { readonly diff: string }
  | { readonly ended: 'review_refused' | 'review_withheld' | 'retries_exhausted' };

export type PostReviewInput = {
  readonly verdict: ReviewVerdict;
  readonly findings: readonly ReadFinding[];
  readonly resolvedProvider: string | null;
  readonly resolvedModel: string;
};

type Weighed = Omit<PostReviewInput, 'findings'> & {
  readonly findings: readonly ReviewFinding[];
};

type Target = { readonly ref: PullRequestRef; readonly head: string };

type Planned = {
  readonly request: ReviewRequest;
  readonly record: Omit<ReviewRecord, 'reviewId'>;
};

const REVIEW_DIFF_BUDGET = 80_000;
const UNREPORTED_MODEL = 'unreported';
const decisive: ReadonlySet<ReviewFact['state']> = new Set([
  'approved',
  'changes_requested',
  'dismissed',
]);

async function reviewScene(
  ports: ReviewPorts,
  caller: Caller,
  runId: string,
): Promise<KernelOutcome<RunScene>> {
  const scene = await runScene(ports, caller, runId);
  if (scene.status !== 'accepted') return scene;
  if (scene.value.capability !== 'review') {
    return refused('not_permitted', { why: 'not_a_review_run' });
  }
  return scene;
}

function targetOf({ item }: RunScene): Target | null {
  const { pullRequest, expectedHead } = item;
  return pullRequest === null || expectedHead === null
    ? null
    : { ref: pullRequest, head: expectedHead };
}

async function endedAs<T>(
  outcome: Promise<KernelOutcome<RunRow>>,
  value: T,
): Promise<KernelOutcome<T>> {
  const settled = await outcome;
  return settled.status === 'accepted' ? accepted(value) : settled;
}

function overBudget(ports: ReviewPorts, caller: Caller, runId: string) {
  const outcome = completeAfter(ports, caller, runId, {
    result: 'review_refused',
    review: null,
    before: (item) => [
      draft('checks_failed', { stage: item.stageKey, failures: [OVER_REVIEW_BUDGET] }),
    ],
  });
  return endedAs<ReviewDiff>(outcome, { ended: 'review_refused' });
}

function unavailable(ports: ReviewPorts, caller: Caller, runId: string, reason: string) {
  const detail = isFailureDetail(reason) ? reason : 'unavailable';
  const outcome = fail(ports, caller, runId, { step: 'work', why: 'retries_exhausted', detail });
  return endedAs<ReviewDiff>(outcome, { ended: 'retries_exhausted' });
}

function withheld(ports: ReviewPorts, caller: Caller, runId: string) {
  const outcome = complete(ports, caller, runId, { result: 'review_withheld', review: null });
  return endedAs<ReviewDiff>(outcome, { ended: 'review_withheld' });
}

export async function reviewDiff(
  ports: ReviewPorts,
  caller: Caller,
  runId: string,
): Promise<KernelOutcome<ReviewDiff>> {
  const scene = await reviewScene(ports, caller, runId);
  if (scene.status !== 'accepted') return scene;
  const target = targetOf(scene.value);
  const facts = target === null ? null : await ports.githubFacts.pullRequest(target.ref);
  if (target === null || facts === null) return withheld(ports, caller, runId);
  const range = { base: facts.base, head: target.head };
  const read = await ports.githubFacts.diff(target.ref, range, REVIEW_DIFF_BUDGET);
  if (read.kind === 'diff') return accepted({ diff: read.text });
  if (read.kind === 'too_large') return overBudget(ports, caller, runId);
  return unavailable(ports, caller, runId, read.reason);
}

function latestDecisive(facts: PullRequestFacts, head: string): ReadonlyMap<string, ReviewFact> {
  const latest = new Map<string, ReviewFact>();
  for (const review of facts.reviews) {
    const reviewer = reviewerOf(review.reviewer);
    if (reviewer === null || fullSha(review.commit) !== head || !decisive.has(review.state)) {
      continue;
    }
    const seen = latest.get(reviewer);
    if (seen === undefined || review.reviewId > seen.reviewId) latest.set(reviewer, review);
  }
  return latest;
}

function providerTaken(facts: PullRequestFacts, own: string, target: Target, provider: string) {
  const mine = normalisedIdentifier(provider);
  return [...latestDecisive(facts, target.head)].some(
    ([reviewer, review]) =>
      reviewer !== own &&
      review.state !== 'dismissed' &&
      review.provider !== null &&
      normalisedIdentifier(review.provider) === mine,
  );
}

function pinnedProvider(run: RunRow, resolved: string | null): string | null {
  if (resolved === null || resolved !== run.pinnedProvider) return null;
  return providerIdSchema.safeParse(resolved).success ? resolved : null;
}

type Grounds = {
  readonly scene: RunScene;
  readonly target: Target;
  readonly reviewer: string;
  readonly provider: string;
  readonly repository: string;
};

function groundsOf(scene: RunScene, input: Weighed): Grounds | null {
  const provider = pinnedProvider(scene.run, input.resolvedProvider);
  const reviewer = engineDescriptor(scene.run.engine).reviewer;
  const target = targetOf(scene);
  const { repository } = scene.harness;
  if (provider === null || reviewer === null || target === null || repository === null) {
    return null;
  }
  return { scene, target, reviewer, provider, repository };
}

function plannedFrom(grounds: Grounds, input: Weighed): Planned {
  const { scene, target, reviewer, provider, repository } = grounds;
  const parsed = modelIdSchema.safeParse(input.resolvedModel);
  const model = parsed.success ? parsed.data : UNREPORTED_MODEL;
  const { verdict, findings } = input;
  return {
    request: {
      reviewer,
      repository,
      pullRequest: target.ref,
      head: target.head,
      verdict,
      body: reviewBody({ provider, model, verdict, findings }),
      traceId: scene.run.traceId,
    },
    record: { reviewer, provider, model, verdict, findings: [...findings] },
  };
}

function ownReview(facts: PullRequestFacts, grounds: Grounds): ReviewFact | null {
  let own: ReviewFact | null = null;
  for (const review of facts.reviews) {
    if (reviewerOf(review.reviewer) !== grounds.reviewer) continue;
    if (fullSha(review.commit) !== grounds.target.head) continue;
    if (own === null || review.reviewId > own.reviewId) own = review;
  }
  return own;
}

type Plan =
  | { readonly kind: 'withhold' }
  | { readonly kind: 'reuse'; readonly planned: Planned; readonly reviewId: number }
  | { readonly kind: 'post'; readonly planned: Planned };

const withhold: Plan = { kind: 'withhold' };

async function plan(ports: ReviewPorts, scene: RunScene, input: Weighed): Promise<Plan> {
  const grounds = groundsOf(scene, input);
  if (grounds === null) return withhold;
  const facts = await ports.githubFacts.pullRequest(grounds.target.ref);
  if (facts === null) return withhold;
  const own = ownReview(facts, grounds);
  if (own !== null) {
    return { kind: 'reuse', planned: plannedFrom(grounds, input), reviewId: own.reviewId };
  }
  const taken = providerTaken(facts, grounds.reviewer, grounds.target, grounds.provider);
  return taken ? withhold : { kind: 'post', planned: plannedFrom(grounds, input) };
}

async function postedId(ports: ReviewPorts, planned: Plan): Promise<number | null> {
  if (planned.kind === 'reuse') return planned.reviewId;
  if (planned.kind !== 'post') return null;
  const outcome = await ports.connectors.review(planned.planned.request);
  return outcome.outcome === 'posted' ? outcome.reviewId : null;
}

async function shadowReview(
  ports: ReviewPorts,
  caller: Caller,
  runId: string,
  input: { readonly scene: RunScene; readonly review: Weighed },
): Promise<KernelOutcome<RunRow>> {
  const grounds = groundsOf(input.scene, input.review);
  if (grounds === null) {
    return complete(ports, caller, runId, { result: 'review_withheld', review: null });
  }
  const { record } = plannedFrom(grounds, input.review);
  const done = await completeAfter(ports, caller, runId, {
    result: 'review_withheld',
    review: { ...record, reviewId: null },
    before: () => [
      draft('review_verdict_recorded', {
        runId,
        head: grounds.target.head,
        ...record,
        findings: [...input.review.findings],
      }),
    ],
  });
  if (done.status !== 'accepted') return done;
  await recordShadowVerdicts(ports, caller, { pullRequest: grounds.target.ref });
  return done;
}

function weighedReview(scene: RunScene, input: PostReviewInput): Weighed | null {
  const findings = weighedFindings(input.findings);
  if (findings === null) return null;
  const verdict = postedVerdict(scene.persona.approveAt, input.verdict, findings);
  return { ...input, verdict, findings };
}

async function unweighed(
  ports: ReviewPorts,
  caller: Caller,
  runId: string,
): Promise<KernelOutcome<RunRow>> {
  const why = { step: 'work' as const, why: 'finding_weight_missing' as const, detail: null };
  const failed = await fail(ports, caller, runId, why);
  return failed.status === 'accepted' ? refused('finding_weight_missing', { runId }) : failed;
}

export async function postReview(
  ports: ReviewPorts,
  caller: Caller,
  runId: string,
  input: PostReviewInput,
): Promise<KernelOutcome<RunRow>> {
  const scene = await reviewScene(ports, caller, runId);
  if (scene.status !== 'accepted') return scene;
  const review = weighedReview(scene.value, input);
  if (review === null) return unweighed(ports, caller, runId);
  if (scene.value.harness.shadow) {
    return shadowReview(ports, caller, runId, { scene: scene.value, review });
  }
  const planned = await plan(ports, scene.value, review);
  if (planned.kind === 'withhold') {
    return complete(ports, caller, runId, { result: 'review_withheld', review: null });
  }
  const reviewId = await postedId(ports, planned);
  const record = { ...planned.planned.record, reviewId };
  if (reviewId === null)
    return complete(ports, caller, runId, { result: 'review_withheld', review: record });
  return completeAfter(ports, caller, runId, {
    result: 'review_posted',
    review: record,
    before: () => [],
    after: handOff(record),
  });
}

function handOff(review: ReviewRecord): TrailingDrafts {
  return async (tx, { item, run }) => {
    if (run.delegationId === null) return [];
    const events = await readAllEvents(tx, item.harnessId, item.itemId);
    const rounds = roundsAfter(events, item.stageKey, review);
    const delegation = rounds === null ? null : await tx.delegations.read.byId(run.delegationId);
    if (rounds === null || delegation === null) return [];
    return [
      draft('checks_failed', { stage: item.stageKey, failures: ['review_rounds_exhausted'] }),
      draft('handed_to_person', {
        personId: delegation.personId,
        why: 'review_rounds_exhausted',
        rounds,
      }),
    ];
  };
}
