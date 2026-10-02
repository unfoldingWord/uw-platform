import { sweepGitHubJob } from './github-sweep.ts';
import type { CronJob } from './job.ts';

export const GITHUB_SWEEP_CRON = '17 3 * * *';

export const cronJobs: ReadonlyMap<string, CronJob> = new Map([
  [GITHUB_SWEEP_CRON, sweepGitHubJob],
]);
