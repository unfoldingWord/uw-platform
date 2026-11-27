import { errorFields, type Logger } from '@uw/core/log';
import { systemPrincipal } from '@uw/core/principal';
import { hyperdriveDatabase, type DatabaseHandle } from '../database.ts';
import { platformKernel } from '../kernel.ts';
import { cronLogger, type CronJob } from './job.ts';

const STEP = 'assistant-retention';

async function released(database: DatabaseHandle, logger: Logger): Promise<void> {
  try {
    await database.release();
  } catch {
    logger.warn('database release failed', { outcome: 'release_failed' });
  }
}

export const redactAssistantHistoryJob: CronJob = async (env, deps) => {
  const logger = cronLogger(deps, 'cron assistant retention');
  const database = hyperdriveDatabase(env);
  if (database === null) {
    logger.warn('assistant retention skipped: no database', {
      step: STEP,
      outcome: 'database_not_configured',
    });
    return;
  }
  try {
    const kernel = platformKernel(database, { now: deps.now });
    const caller = { actor: systemPrincipal(), traceId: deps.newId(), requestId: null };
    const outcome = await kernel.assistants.redactHistory(caller, {});
    if (outcome.status === 'accepted') {
      const { requests, done } = outcome.value;
      logger.info('assistant history redacted', {
        step: STEP,
        outcome: 'history_redacted',
        requests,
        done,
      });
    } else {
      logger.warn('assistant retention refused', { step: STEP, outcome: outcome.reason });
    }
  } catch (error) {
    logger.error('assistant retention failed', {
      step: STEP,
      outcome: 'internal_error',
      ...errorFields(error),
    });
  } finally {
    await released(database, logger);
  }
};
