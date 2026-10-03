import { errorFields, type Logger } from '@uw/core/log';
import { systemPrincipal } from '@uw/core/principal';
import { DEFAULT_SPEND_CAP, PortNotWiredError, type Caller, type Kernel } from '@uw/harness';
import { hyperdriveDatabase, type DatabaseHandle } from '../database.ts';
import { gatewaySpend } from '../engines/gateway/spend.ts';
import type { Bindings } from '../env.ts';
import { hubWiring, platformKernel } from '../kernel.ts';
import { hubOf } from '../ports/hub.ts';
import { spendOnlyEngine } from '../ports/model-engine.ts';
import { unitHub } from '../unit-hub.ts';
import { cronLogger, type CronDeps, type CronJob } from './job.ts';

const SWEEP_LIMIT = 200;
const BEAT_LIMIT = 10;
const POSITIVE_INTEGER = /^[1-9]\d{0,14}$/;

type Minute = {
  readonly kernel: Kernel;
  readonly caller: Caller;
  readonly deps: CronDeps;
  readonly logger: Logger;
};

function capOf(deps: CronDeps): number {
  const configured = deps.engines.AI_SPEND_CAP_MINOR ?? '';
  return POSITIVE_INTEGER.test(configured) ? Number(configured) : DEFAULT_SPEND_CAP.capMinor;
}

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function sweep({ kernel, caller, logger }: Minute): Promise<void> {
  const swept = await kernel.items.expireLeases(caller, { limit: SWEEP_LIMIT });
  if (swept.status !== 'accepted') {
    logger.warn('lease sweep refused', { step: 'sweep', outcome: swept.reason });
    return;
  }
  logger.info('leases swept', {
    step: 'sweep',
    outcome: 'leases_swept',
    expired: swept.value.expired.length,
  });
}

async function checkBreaker({ kernel, caller, deps, logger }: Minute): Promise<void> {
  const capMinor = capOf(deps);
  const since = monthStart(deps.now());
  const checked = await kernel.breaker.check(caller, { capMinor, currency: 'USD', since });
  if (checked.status !== 'accepted') {
    logger.warn('breaker check refused', { step: 'breaker', outcome: checked.reason });
    return;
  }
  const { level, percent, hibernated, resumed } = checked.value;
  logger.info('breaker checked', {
    step: 'breaker',
    outcome: 'breaker_checked',
    breaker_level: level,
    percent,
    hibernated: hibernated.length,
    resumed: resumed.length,
  });
}

async function beat({ kernel, caller, logger }: Minute): Promise<void> {
  const beaten = await kernel.runs.beat(caller, { limit: BEAT_LIMIT });
  if (beaten.status !== 'accepted') {
    logger.warn('beat refused', { step: 'beat', outcome: beaten.reason });
    return;
  }
  logger.info('beat finished', {
    step: 'beat',
    outcome: 'beat_finished',
    started: beaten.value.started.length,
    skipped: beaten.value.skipped.length,
  });
}

function failureOf(step: string, error: unknown): string {
  if (step === 'breaker' && error instanceof PortNotWiredError) return 'breaker_not_configured';
  if (step === 'breaker') return 'breaker_unreadable';
  return 'internal_error';
}

async function guarded(
  minute: Minute,
  step: string,
  work: (minute: Minute) => Promise<void>,
): Promise<void> {
  try {
    await work(minute);
  } catch (error) {
    minute.logger.error('minute step failed', {
      step,
      outcome: failureOf(step, error),
      ...errorFields(error),
    });
  }
}

async function minuteWith(
  database: DatabaseHandle,
  env: Bindings,
  deps: CronDeps,
  logger: Logger,
): Promise<void> {
  const unit = unitHub(hubOf(env, logger));
  const modelEngine = spendOnlyEngine(gatewaySpend(deps.engines, deps.now));
  const kernel = platformKernel(database, { now: deps.now }, hubWiring(unit.hub, { modelEngine }));
  const caller: Caller = { actor: systemPrincipal(), traceId: deps.newId(), requestId: null };
  const minute = { kernel, caller, deps, logger };
  try {
    await guarded(minute, 'sweep', sweep);
    await guarded(minute, 'breaker', checkBreaker);
    await guarded(minute, 'beat', beat);
  } finally {
    await unit.flush();
  }
}

async function released(database: DatabaseHandle, logger: Logger): Promise<void> {
  try {
    await database.release();
  } catch {
    logger.warn('database release failed', { outcome: 'release_failed' });
  }
}

export const minuteJob: CronJob = async (env, deps) => {
  const logger = cronLogger(deps, 'cron minute');
  const database = hyperdriveDatabase(env);
  if (database === null) {
    logger.warn('minute job skipped: no database', { outcome: 'database_not_configured' });
    return;
  }
  try {
    await minuteWith(database, env, deps, logger);
  } finally {
    await released(database, logger);
  }
};
