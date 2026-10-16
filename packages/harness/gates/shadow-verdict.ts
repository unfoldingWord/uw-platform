import {
  eventEvidenceSchemas,
  type EventEvidence,
  type Harness,
  type HarnessEvent,
  type ItemState,
  type Principal,
} from '@uw/contracts';
import { fullSha } from '../github/identifiers.ts';
import { reviewerIdentities } from '../github/reviewers.ts';
import type { PullRequestFacts, ReviewFact } from '../ports.ts';
import { shipPreview } from './approve-at-ship.ts';

export type ShadowVerdict = EventEvidence['shadow_verdict'];

export type ShadowSource = {
  readonly facts: PullRequestFacts | null;
  readonly item: ItemState;
  readonly harness: Harness;
  readonly events: readonly HarnessEvent[];
  readonly approver: Principal;
  readonly at: Date;
};

const RECORDED_REVIEW_ID = 0;
const approverBound = 'approver_lacks_domain_grant';

function loginOf(reviewer: string): string | null {
  return reviewerIdentities.find((entry) => entry.reviewer === reviewer)?.login ?? null;
}

function recordedReviews(event: HarnessEvent): readonly ReviewFact[] {
  if (event.name !== 'review_verdict_recorded') return [];
  const recorded = eventEvidenceSchemas.review_verdict_recorded.parse(event.evidence);
  const login = loginOf(recorded.reviewer);
  if (login === null) return [];
  return [
    {
      reviewId: RECORDED_REVIEW_ID,
      reviewer: login,
      commit: recorded.head,
      state: recorded.verdict === 'approve' ? 'approved' : 'changes_requested',
      provider: recorded.provider,
      findings: [...recorded.findings],
      submittedAt: new Date(event.at),
    },
  ];
}

function withRecorded(facts: PullRequestFacts, events: readonly HarnessEvent[]): PullRequestFacts {
  return { ...facts, reviews: [...facts.reviews, ...events.flatMap(recordedReviews)] };
}

export function shadowVerdictOf(source: ShadowSource): ShadowVerdict {
  const facts = source.facts === null ? null : withRecorded(source.facts, source.events);
  const { item, harness, approver, at } = source;
  const preview = shipPreview({ facts, item, harness, approver, at, override: false });
  const reasons =
    preview.outcome.verdict === 'advance'
      ? []
      : preview.outcome.reasons.filter((reason) => reason !== approverBound);
  const head = preview.input.pullRequest === null ? null : fullSha(preview.input.pullRequest.head);
  return { head, verdict: reasons.length === 0 ? 'advance' : 'refuse', reasons };
}

export function lastShadowVerdict(events: readonly HarnessEvent[]): ShadowVerdict | null {
  const last = events.findLast((event) => event.name === 'shadow_verdict');
  return last === undefined ? null : eventEvidenceSchemas.shadow_verdict.parse(last.evidence);
}

export function sameVerdict(left: ShadowVerdict, right: ShadowVerdict): boolean {
  return (
    left.head === right.head &&
    left.verdict === right.verdict &&
    left.reasons.join(',') === right.reasons.join(',')
  );
}
