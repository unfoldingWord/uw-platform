import {
  eventEvidenceSchemas,
  type HarnessEvent,
  type ItemState,
  type ShadowRow,
} from '@uw/contracts';
import { fullSha } from '../github/identifiers.ts';
import { reviewerOf } from '../github/reviewers.ts';
import type { PullRequestFacts, PullRequestRef, ReviewFact, ReviewState } from '../ports.ts';

type OtherState = ShadowRow['github'][number]['state'];
type Part = Partial<Pick<ShadowRow, 'shadow' | 'reviewer'>>;
type Entry = { readonly head: string; readonly part: Part };
type Collected = {
  readonly item: ItemState;
  readonly pullRequest: PullRequestRef;
  readonly head: string;
  readonly shadow: ShadowRow['shadow'];
  readonly reviewer: ShadowRow['reviewer'];
};

export type RowsInput = {
  readonly events: readonly HarnessEvent[];
  readonly items: readonly ItemState[];
  readonly facts: ReadonlyMap<string, PullRequestFacts | null>;
};

const otherStates: ReadonlySet<ReviewState> = new Set<ReviewState>([
  'approved',
  'changes_requested',
  'dismissed',
]);

function isOther(state: ReviewState): state is OtherState {
  return otherStates.has(state);
}

function entryOf(event: HarnessEvent): Entry | null {
  if (event.name === 'shadow_verdict') {
    const verdict = eventEvidenceSchemas.shadow_verdict.parse(event.evidence);
    if (verdict.head === null) return null;
    const shadow = { verdict: verdict.verdict, reasons: [...verdict.reasons] };
    return { head: verdict.head, part: { shadow } };
  }
  if (event.name === 'review_verdict_recorded') {
    const recorded = eventEvidenceSchemas.review_verdict_recorded.parse(event.evidence);
    const reviewer = {
      reviewer: recorded.reviewer,
      verdict: recorded.verdict,
      findings: [...recorded.findings],
    };
    return { head: recorded.head, part: { reviewer } };
  }
  return null;
}

function collect(input: RowsInput): ReadonlyMap<string, Collected> {
  const byId = new Map(input.items.map((item) => [item.itemId, item]));
  const rows = new Map<string, Collected>();
  for (const event of [...input.events].sort((a, b) => a.position - b.position)) {
    const item = event.itemId === null ? undefined : byId.get(event.itemId);
    const entry = entryOf(event);
    if (item === undefined || item.pullRequest === null || entry === null) continue;
    const key = `${item.itemId} ${entry.head}`;
    const empty = {
      item,
      pullRequest: item.pullRequest,
      head: entry.head,
      shadow: null,
      reviewer: null,
    };
    rows.set(key, { ...(rows.get(key) ?? empty), ...entry.part });
  }
  return rows;
}

function othersOn(facts: PullRequestFacts | null, head: string): ShadowRow['github'] {
  const latest = new Map<string, ReviewFact & { readonly state: OtherState }>();
  for (const review of facts?.reviews ?? []) {
    const { state } = review;
    if (
      reviewerOf(review.reviewer) !== null ||
      fullSha(review.commit) !== head ||
      !isOther(state)
    ) {
      continue;
    }
    const login = review.reviewer.trim().toLowerCase();
    const seen = latest.get(login);
    if (seen === undefined || review.reviewId > seen.reviewId)
      latest.set(login, { ...review, state });
  }
  return [...latest.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([reviewer, review]) => ({ reviewer, state: review.state }));
}

function disagreeing(reviewer: ShadowRow['reviewer'], github: ShadowRow['github']): boolean {
  if (reviewer === null) return false;
  const opposite: OtherState = reviewer.verdict === 'approve' ? 'changes_requested' : 'approved';
  return github.some((review) => review.state === opposite);
}

export function comparisonRows(input: RowsInput): ShadowRow[] {
  return [...collect(input).values()].map(({ item, pullRequest, head, shadow, reviewer }) => {
    const github = othersOn(input.facts.get(item.itemId) ?? null, head);
    return {
      itemId: item.itemId,
      title: item.title,
      pullRequest,
      head,
      shadow,
      reviewer,
      github,
      disagrees: disagreeing(reviewer, github),
    };
  });
}
