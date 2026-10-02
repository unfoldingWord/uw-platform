import type { IngestHandler } from '../queue/consumer.ts';
import { factsFromWebhook } from './facts/normalise.ts';
import { upsertFacts, type UpsertReport } from './facts/upsert.ts';
import { followUpserts, type GitHubDeps } from './follow-up.ts';

function repairedFields({ repaired }: UpsertReport): Readonly<Record<string, number>> {
  return {
    repaired_repos: repaired.repos,
    repaired_milestones: repaired.milestones,
    repaired_issues: repaired.issues,
    repaired_pull_requests: repaired.pullRequests,
    repaired_check_runs: repaired.checkRuns,
    repaired_reviews: repaired.reviews,
    repaired_files: repaired.files,
  };
}

export function githubIngestHandler(deps: GitHubDeps): IngestHandler {
  return async (envelope, logger) => {
    const delivery = { event: envelope.event, delivery_id: envelope.deliveryId };
    if (envelope.payloadTruncated) {
      logger.warn('github delivery too large to queue', {
        outcome: 'payload_truncated',
        ...delivery,
      });
      return 'handled';
    }
    const normalised = factsFromWebhook(envelope.event, envelope.payload);
    if (normalised.kind === 'ignored') {
      logger.info('github delivery ignored', { outcome: 'ignored', ...delivery });
      return 'handled';
    }
    if (normalised.kind === 'malformed') {
      logger.warn('github delivery malformed', { outcome: 'malformed_payload', ...delivery });
      return 'malformed';
    }
    const report = await upsertFacts(deps.db, normalised.batch, deps.now());
    logger.info('github delivery upserted', {
      outcome: 'upserted',
      ...delivery,
      ...repairedFields(report),
    });
    await followUpserts(deps, report, logger);
    return 'handled';
  };
}
