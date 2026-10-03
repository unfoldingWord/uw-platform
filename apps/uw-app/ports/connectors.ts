import {
  sameRepository,
  type Connectors,
  type EffectConnector,
  type EffectHandler,
  type ReviewOutcome,
  type ReviewRequest,
} from '@uw/harness';
import { mergeHandler, type MergeGitHub } from '../github/merge.ts';
import { createReviewWrites, type ReviewGitHub } from '../github/review-writes.ts';

export type ShipGitHub = MergeGitHub;
export type { ReviewGitHub };

const reviewRefusals: ReadonlyMap<string, string> = new Map([['unprocessable', 'head_moved']]);

const notWiredConnector: EffectHandler = {
  run: async () => ({ outcome: 'refused', reason: 'not_wired' }),
  outcomeOf: async () => ({ outcome: 'refused', reason: 'not_wired' }),
};

function handlersFor(github: ShipGitHub | null): ReadonlyMap<EffectConnector, EffectHandler> {
  return new Map<EffectConnector, EffectHandler>([
    ['merge', github === null ? notWiredConnector : mergeHandler(github)],
    ['deploy', notWiredConnector],
    ['publish', notWiredConnector],
    ['send', notWiredConnector],
    ['post', notWiredConnector],
  ]);
}

async function postReview(
  reviews: ReviewGitHub | null,
  request: ReviewRequest,
): Promise<ReviewOutcome> {
  if (!sameRepository(request.pullRequest.repo, request.repository)) {
    return { outcome: 'refused', reason: 'repository_mismatch' };
  }
  const app = reviews?.apps.get(request.reviewer);
  if (reviews === null || app === undefined) return { outcome: 'refused', reason: 'not_wired' };
  const writes = createReviewWrites(app, reviews.transport);
  const { head, verdict, body } = request;
  const posted = await writes.post(request.repository, request.pullRequest.number, {
    head,
    verdict,
    body,
  });
  if (posted.ok) return { outcome: 'posted', reviewId: posted.value.reviewId };
  const reason = reviewRefusals.get(posted.failure) ?? `github_${posted.failure}`;
  return { outcome: 'refused', reason };
}

export function platformConnectors(
  github: ShipGitHub | null,
  reviews: ReviewGitHub | null = null,
): Connectors {
  const handlers = handlersFor(github);
  const handlerOf = (connector: EffectConnector) => handlers.get(connector) ?? notWiredConnector;
  return {
    run: (request) => handlerOf(request.connector).run(request),
    outcomeOf: (request) => handlerOf(request.connector).outcomeOf(request),
    review: (request) => postReview(reviews, request),
  };
}
