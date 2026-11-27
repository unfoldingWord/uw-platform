import { errorFields, type Logger } from '@uw/core/log';
import { systemPrincipal } from '@uw/core/principal';
import { hyperdriveDatabase, type DatabaseHandle } from '../database.ts';
import { platformKernel } from '../kernel.ts';
import { cronLogger, type CronJob } from './job.ts';

const STEP = 'assistant-proposal-expiry';
const EXPIRE_MOST = 200;

async function released(database: DatabaseHandle, logger: Logger): Promise<void> {
  try {
    await database.release();
  } catch {
    logger.warn('database release failed', { outcome: 'release_failed' });
  }
}

export const expireAssistantProposalsJob: CronJob = async (env, deps) => {
  const logger = cronLogger(deps, 'cron assistant proposal expiry');
  const database = hyperdriveDatabase(env);
  if (database === null) {
    logger.warn('assistant proposal expiry skipped: no database', {
      step: STEP,
      outcome: 'database_not_configured',
    });
    return;
  }
  try {
    const kernel = platformKernel(database, { now: deps.now });
    const caller = { actor: systemPrincipal(), traceId: deps.newId(), requestId: null };
    const outcome = await kernel.assistants.expireProposals(caller, { limit: EXPIRE_MOST });
    if (outcome.status === 'accepted') {
      const expired = outcome.value.expired.length;
      logger.info('assistant proposals expired', { step: STEP, outcome: 'expired', expired });
    } else {
      logger.warn('assistant proposal expiry refused', { step: STEP, outcome: outcome.reason });
    }
  } catch (error) {
    logger.error('assistant proposal expiry failed', {
      step: STEP,
      outcome: 'internal_error',
      ...errorFields(error),
    });
  } finally {
    await released(database, logger);
  }
};
