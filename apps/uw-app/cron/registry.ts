import { sweepGitHubJob } from './github-sweep.ts';
import type { CronJob } from './job.ts';
import { minuteJob } from './minute.ts';
import { pruneRequestsJob } from './request-retention.ts';

export const GITHUB_SWEEP_CRON = '17 3 * * *';
export const MINUTE_CRON = '* * * * *';

const nightlyJob: CronJob = async (env, deps) => {
  await pruneRequestsJob(env, deps);
  await sweepGitHubJob(env, deps);
};

export const cronJobs: ReadonlyMap<string, CronJob> = new Map([
  [GITHUB_SWEEP_CRON, nightlyJob],
  [MINUTE_CRON, minuteJob],
]);
