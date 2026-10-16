import {
  eventEvidenceSchemas,
  type CapabilityWord,
  type Harness,
  type HarnessEvent,
  type ItemState,
  type ReviewRecord,
  type Stage,
} from '@uw/contracts';
import { capabilityReaches } from '../delegations/capability.ts';
import { delegableExit } from '../gates/delegable.ts';
import { joinedPullRequest } from '../gates/ship-input.ts';
import type { StoreTransaction } from '../ports.ts';
import { setsHead } from '../runs/backoff.ts';
import { countsAsRound } from '../runs/weights.ts';
import { readAllEvents } from './record.ts';

export type FixRound = { readonly review: ReviewRecord | null; readonly claimed: boolean };

const leavesStage: ReadonlySet<string> = new Set(['stage_advanced', 'loop_edge_taken']);
const closed: FixRound = { review: null, claimed: false };

function countedReview(event: HarnessEvent): ReviewRecord | null {
  if (event.name !== 'run_completed') return null;
  const { result, review } = eventEvidenceSchemas.run_completed.parse(event.evidence);
  return result === 'review_posted' && review !== null && countsAsRound(review) ? review : null;
}

function nextRound(round: FixRound, event: HarnessEvent): FixRound {
  if (setsHead(event) || leavesStage.has(event.name)) return closed;
  if (event.name === 'fix_claimed') return { ...round, claimed: round.review !== null };
  const review = countedReview(event);
  return review === null ? round : { review, claimed: false };
}

export function fixRound(events: readonly HarnessEvent[]): FixRound {
  return events.reduce(nextRound, closed);
}

export function fixOffered(
  harness: Harness,
  item: ItemState,
  events: readonly HarnessEvent[],
): boolean {
  if (!harness.fixClaim || harness.shadow) return false;
  if (item.pullRequest === null || item.expectedHead === null || joinedPullRequest(item)) {
    return false;
  }
  const round = fixRound(events);
  return round.review !== null && !round.claimed;
}

export function onlyByFix(stage: Stage, reach: ReadonlySet<CapabilityWord> | null): boolean {
  if (reach === null || !reach.has('fix') || delegableExit(stage)) return false;
  return ![...reach].some(
    (capability) => capability !== 'fix' && capabilityReaches(capability, stage.bracket),
  );
}

export async function offeredForFix(
  tx: StoreTransaction,
  harness: Harness,
  reach: ReadonlySet<CapabilityWord> | null,
  stages: readonly Stage[],
  item: ItemState,
): Promise<boolean> {
  const stage = stages.find((entry) => entry.key === item.stageKey);
  if (stage === undefined || !onlyByFix(stage, reach)) return true;
  return fixOffered(harness, item, await readAllEvents(tx, item.harnessId, item.itemId));
}

export function roundFindings(events: readonly HarnessEvent[]): readonly string[] {
  const { review } = fixRound(events);
  if (review === null) return [];
  return review.findings
    .filter((finding) => finding.weight !== 'theoretical')
    .map((finding) => `${finding.weight}: ${finding.text}`);
}
