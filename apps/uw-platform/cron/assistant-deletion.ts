import { errorFields, type Logger } from '@uw/core/log';
import { provisionerOf } from '../assistants/provisioning/deps.ts';
import { deleteTurnedOff } from '../assistants/provisioning/deletion.ts';
import { hyperdriveDatabase, type DatabaseHandle } from '../database.ts';
import { platformKernel } from '../kernel.ts';
import { cronLogger, type CronJob } from './job.ts';

const DELETION_LIMIT = 20;

async function released(database: DatabaseHandle, logger: Logger): Promise<void> {
  try {
    await database.release();
  } catch {
    logger.warn('database release failed', { outcome: 'release_failed' });
  }
}

export const deleteTurnedOffAssistantsJob: CronJob = async (env, deps) => {
  const logger = cronLogger(deps, 'cron assistant deletion');
  const database = hyperdriveDatabase(env);
  if (database === null) {
    logger.warn('assistant deletion skipped: no database', {
      step: 'assistant-deletion',
      outcome: 'database_not_configured',
    });
    return;
  }
  try {
    const clock = { now: deps.now };
    const kernel = platformKernel(database, clock);
    const host = { env, database, fetch: deps.fetch, clock, kernel, traceId: deps.newId() };
    const done = await deleteTurnedOff(provisionerOf(host), DELETION_LIMIT);
    logger.info('turned-off assistants deleted', {
      step: 'assistant-deletion',
      outcome: 'assistants_deleted',
      deleted: done.deleted.length,
      failed: done.failed.length,
    });
  } catch (error) {
    logger.error('assistant deletion failed', {
      step: 'assistant-deletion',
      outcome: 'internal_error',
      ...errorFields(error),
    });
  } finally {
    await released(database, logger);
  }
};
