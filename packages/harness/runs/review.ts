import {
  modelIdSchema,
  providerIdSchema,
  type ReviewRecord,
  type ReviewVerdict,
} from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { engineDescriptor } from '../engines.ts';
import { fullSha, normalisedIdentifier } from '../github/identifiers.ts';
import { reviewBody } from '../github/review-body.ts';
import { reviewerOf } from '../github/reviewers.ts';
import { OVER_REVIEW_BUDGET } from '../items/held-for-person.ts';
import { draft } from '../items/record.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type {
  Ports,
  PullRequestFacts,
  PullRequestRef,
  ReviewFact,
  ReviewRequest,
  RunRow,
} from '../ports.ts';
import { complete, completeAfter, fail } from './lifecycle.ts';
import { runScene } from './scene.ts';
import type { RunScene } from './types.ts';

type ReviewPorts = Pick<Ports, 'clock' | 'connectors' | 'githubFacts' | 'grants' | 'ids' | 'store'>;

export type ReviewDiff =
  | { readonly diff: string }
  | { readonly ended: 'review_refused' | 'review_withheld' | 'retries_exhausted' };

export type PostReviewInput = {
  readonly verdict: ReviewVerdict;
  readonly findings: readonly string[];
  readonly resolvedProvider: string | null;
  readonly resolvedModel: string;
};

type Target = { readonly ref: PullRequestRef; readonly head: string };

type Planned = {
  readonly request: ReviewRequest;
  readonly record: Omit<ReviewRecord, 'reviewId'>;
};

const REVIEW_DIFF_BUDGET = 80_000;
const UNREPORTED_MODEL = 'unreported';
const PRINTABLE = /^[ -~]{1,500}$/;
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
  const detail = PRINTABLE.test(reason) ? reason : 'unavailable';
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

function groundsOf(scene: RunScene, input: PostReviewInput): Grounds | null {
  const provider = pinnedProvider(scene.run, input.resolvedProvider);
  const reviewer = engineDescriptor(scene.run.engine).reviewer;
  const target = targetOf(scene);
  const { repository } = scene.harness;
  if (provider === null || reviewer === null || target === null || repository === null) {
    return null;
  }
  return { scene, target, reviewer, provider, repository };
}

function plannedFrom(grounds: Grounds, input: PostReviewInput): Planned {
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
    record: { reviewer, provider, model, verdict },
  };
}

async function plan(
  ports: ReviewPorts,
  scene: RunScene,
  input: PostReviewInput,
): Promise<Planned | null> {
  const grounds = groundsOf(scene, input);
  if (grounds === null) return null;
  const facts = await ports.githubFacts.pullRequest(grounds.target.ref);
  if (facts === null) return null;
  const taken = providerTaken(facts, grounds.reviewer, grounds.target, grounds.provider);
  return taken ? null : plannedFrom(grounds, input);
}

export async function postReview(
  ports: ReviewPorts,
  caller: Caller,
  runId: string,
  input: PostReviewInput,
): Promise<KernelOutcome<RunRow>> {
  const scene = await reviewScene(ports, caller, runId);
  if (scene.status !== 'accepted') return scene;
  const planned = await plan(ports, scene.value, input);
  if (planned === null) {
    return complete(ports, caller, runId, { result: 'review_withheld', review: null });
  }
  const outcome = await ports.connectors.review(planned.request);
  const posted = outcome.outcome === 'posted';
  return complete(ports, caller, runId, {
    result: posted ? 'review_posted' : 'review_withheld',
    review: { ...planned.record, reviewId: posted ? outcome.reviewId : null },
  });
}
