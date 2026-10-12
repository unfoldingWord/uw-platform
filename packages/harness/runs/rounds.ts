import { eventEvidenceSchemas, type HarnessEvent, type ReviewRecord } from '@uw/contracts';

const REVIEW_ROUND_LIMIT = 3;

function entersStage(event: HarnessEvent, stageKey: string): boolean {
  if (event.name === 'item_created') return event.evidence['stage'] === stageKey;
  if (event.name === 'stage_advanced' || event.name === 'loop_edge_taken') {
    return event.evidence['to'] === stageKey;
  }
  return false;
}

function requestedChanges(event: HarnessEvent, reviewer: string): number | null {
  if (event.name !== 'run_completed') return null;
  const { result, review } = eventEvidenceSchemas.run_completed.parse(event.evidence);
  if (result !== 'review_posted' || review === null) return null;
  if (review.reviewer !== reviewer || review.verdict !== 'request_changes') return null;
  return review.reviewId;
}

function roundsSinceEntry(
  events: readonly HarnessEvent[],
  stageKey: string,
  reviewer: string,
): ReadonlySet<number> {
  const entry = events.findLastIndex((event) => entersStage(event, stageKey));
  const rounds = new Set<number>();
  for (const event of events.slice(entry + 1)) {
    const reviewId = requestedChanges(event, reviewer);
    if (reviewId !== null) rounds.add(reviewId);
  }
  return rounds;
}

export function roundsAfter(
  events: readonly HarnessEvent[],
  stageKey: string,
  review: ReviewRecord,
): number | null {
  if (review.verdict !== 'request_changes' || review.reviewId === null) return null;
  const earlier = roundsSinceEntry(events, stageKey, review.reviewer);
  if (earlier.has(review.reviewId)) return null;
  const rounds = earlier.size + 1;
  return rounds >= REVIEW_ROUND_LIMIT ? rounds : null;
}
