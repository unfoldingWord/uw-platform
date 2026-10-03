import { errorFields, type Logger } from '@uw/core/log';
import { hyperdriveDatabase, type DatabaseHandle } from '../database.ts';
import type { Bindings } from '../env.ts';
import { githubAppOf } from '../github/app-config.ts';
import { sweepGitHub } from '../github/sweep.ts';
import { hubWiring, platformKernel } from '../kernel.ts';
import { systemClock } from '../ports/clock.ts';
import { hubNotWired } from '../ports/hub.not-wired.ts';
import { unitHub } from '../unit-hub.ts';
import { cronLogger, type CronDeps, type CronJob } from './job.ts';

async function sweepWith(
  database: DatabaseHandle,
  env: Bindings,
  deps: CronDeps,
  logger: Logger,
): Promise<void> {
  const app = githubAppOf(env);
  if (app === null) {
    logger.warn('github sweep skipped: GitHub is not configured', {
      outcome: 'github_not_configured',
    });
    return;
  }
  const unit = unitHub(hubNotWired);
  const kernel = platformKernel(database, systemClock, hubWiring(unit.hub));
  const transport = { fetch: deps.fetch, now: deps.now };
  const report = await sweepGitHub(
    { db: database.db, kernel, now: deps.now, app, transport },
    logger,
  ).finally(() => unit.flush());
  logger.info('github sweep finished', {
    outcome: report.failure ?? 'finished',
    repositories: report.repositories.length,
    subrequests: report.subrequests,
  });
}

async function released(database: DatabaseHandle, logger: Logger): Promise<void> {
  try {
    await database.release();
  } catch {
    logger.warn('database release failed', { outcome: 'release_failed' });
  }
}

export const sweepGitHubJob: CronJob = async (env, deps) => {
  const logger = cronLogger(deps, 'cron github sweep');
  const database = hyperdriveDatabase(env);
  if (database === null) {
    logger.warn('github sweep skipped: no database', { outcome: 'database_not_configured' });
    return;
  }
  try {
    await sweepWith(database, env, deps, logger);
  } catch (error) {
    logger.error('github sweep failed', { outcome: 'internal_error', ...errorFields(error) });
  } finally {
    await released(database, logger);
  }
};
