import { errorFields, type Logger } from '@uw/core/log';
import { pruneRequests } from '../commands/requests.ts';
import { hyperdriveDatabase, type DatabaseHandle } from '../database.ts';
import { cronLogger, type CronJob } from './job.ts';

const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

async function released(database: DatabaseHandle, logger: Logger): Promise<void> {
  try {
    await database.release();
  } catch {
    logger.warn('database release failed', { outcome: 'release_failed' });
  }
}

export const pruneRequestsJob: CronJob = async (env, deps) => {
  const logger = cronLogger(deps, 'cron request retention');
  const database = hyperdriveDatabase(env);
  if (database === null) {
    logger.warn('request retention skipped: no database', { outcome: 'database_not_configured' });
    return;
  }
  try {
    const before = new Date(deps.now().getTime() - RETAIN_MS);
    const deleted = await pruneRequests(database.db, before);
    logger.info('command requests pruned', { outcome: 'pruned', deleted });
  } catch (error) {
    logger.error('request retention failed', { outcome: 'internal_error', ...errorFields(error) });
  } finally {
    await released(database, logger);
  }
};
