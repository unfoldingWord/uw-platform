import { errorFields, type Logger } from '@uw/core/log';
import { systemPrincipal } from '@uw/core/principal';
import { hyperdriveDatabase, type DatabaseHandle } from '../database.ts';
import type { Bindings } from '../env.ts';
import { runDueMeasures } from '../measures/due.ts';
import { expireMeasureRaw } from '../measures/expiry.ts';
import { failStalledRuns } from '../measures/runs.ts';
import { measureRunFrom } from '../measures/sandbox.ts';
import { bucketFiles } from '../pages/file-store.ts';
import { cronLogger, type CronDeps, type CronJob } from './job.ts';

const DUE_LIMIT = 20;
const STALLED_LIMIT = 200;

export async function startDueMeasures(
  database: DatabaseHandle,
  env: Bindings,
  deps: CronDeps,
  logger: Logger,
): Promise<void> {
  const stalled = await failStalledRuns(database.db, deps.now(), STALLED_LIMIT);
  logger.info('stalled measure runs closed', {
    step: 'measures',
    outcome: 'runs_stalled',
    stalled,
  });
  const binding = measureRunFrom(env);
  if (binding === null) {
    logger.info('measure runs not started', { step: 'measures', outcome: 'not_wired' });
    return;
  }
  const scheduler = { binding, traceId: deps.newId(), identity: systemPrincipal().identity };
  const started = await runDueMeasures(database.db, scheduler, deps.now(), DUE_LIMIT);
  logger.info('measure runs started', { step: 'measures', outcome: 'runs_started', started });
}

async function released(database: DatabaseHandle, logger: Logger): Promise<void> {
  try {
    await database.release();
  } catch {
    logger.warn('database release failed', { outcome: 'release_failed' });
  }
}

export const expireMeasureRawJob: CronJob = async (env, deps) => {
  const logger = cronLogger(deps, 'cron measure output expiry');
  const database = hyperdriveDatabase(env);
  if (database === null) {
    logger.warn('measure output expiry skipped: no database', {
      outcome: 'database_not_configured',
    });
    return;
  }
  try {
    if (env.FILES === undefined) {
      logger.warn('measure output expiry skipped: no file bucket', { outcome: 'not_wired' });
      return;
    }
    const expired = await expireMeasureRaw(database.db, bucketFiles(env.FILES), deps.now());
    logger.info('measure output expired', { outcome: 'expired', expired });
  } catch (error) {
    logger.error('measure output expiry failed', {
      outcome: 'internal_error',
      ...errorFields(error),
    });
  } finally {
    await released(database, logger);
  }
};
