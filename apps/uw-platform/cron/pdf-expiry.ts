import { errorFields, type Logger } from '@uw/core/log';
import { hyperdriveDatabase, type DatabaseHandle } from '../database.ts';
import { bucketFiles } from '../pages/file-store.ts';
import { expireExports } from '../pdf/exports.ts';
import { cronLogger, type CronJob } from './job.ts';

async function released(database: DatabaseHandle, logger: Logger): Promise<void> {
  try {
    await database.release();
  } catch {
    logger.warn('database release failed', { outcome: 'release_failed' });
  }
}

export const expirePdfExportsJob: CronJob = async (env, deps) => {
  const logger = cronLogger(deps, 'cron pdf export expiry');
  const database = hyperdriveDatabase(env);
  if (database === null) {
    logger.warn('pdf export expiry skipped: no database', { outcome: 'database_not_configured' });
    return;
  }
  try {
    if (env.FILES === undefined) {
      logger.warn('pdf export expiry skipped: no file bucket', { outcome: 'not_wired' });
      return;
    }
    const expired = await expireExports(database.db, bucketFiles(env.FILES), deps.now());
    logger.info('pdf exports expired', { outcome: 'expired', expired });
  } catch (error) {
    logger.error('pdf export expiry failed', { outcome: 'internal_error', ...errorFields(error) });
  } finally {
    await released(database, logger);
  }
};
