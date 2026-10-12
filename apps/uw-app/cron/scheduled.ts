import { engineConfigOf } from '../engines/config.ts';
import { commitOf, type Bindings } from '../env.ts';
import { cronLogger, type CronDeps } from './job.ts';
import { cronJobs } from './registry.ts';

function platformCronDeps(env: Bindings): CronDeps {
  const send = fetch.bind(globalThis);
  return {
    now: () => new Date(),
    fetch: send,
    sink: (line) => console.log(line),
    newId: () => crypto.randomUUID(),
    commit: commitOf(env),
    engines: engineConfigOf(env, send),
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
