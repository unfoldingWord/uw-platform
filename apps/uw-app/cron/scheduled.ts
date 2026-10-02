import { commitOf, type Bindings } from '../env.ts';
import { cronLogger, type CronDeps } from './job.ts';
import { cronJobs } from './registry.ts';

function platformCronDeps(env: Bindings): CronDeps {
  return {
    now: () => new Date(),
    fetch: fetch.bind(globalThis),
    sink: (line) => console.log(line),
    newId: () => crypto.randomUUID(),
    commit: commitOf(env),
  };
}

export async function runScheduled(controller: ScheduledController, env: Bindings): Promise<void> {
  const deps = platformCronDeps(env);
  const job = cronJobs.get(controller.cron);
  if (job === undefined) {
    cronLogger(deps, 'cron').warn('no job is registered for this cron', {
      outcome: 'unknown_cron',
      cron: controller.cron,
    });
    return;
  }
  await job(env, deps);
}
