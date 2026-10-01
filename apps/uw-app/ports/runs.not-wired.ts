import { notWiredCall, type Runs } from '@uw/harness';

export const runsNotWired: Runs = {
  start: () => notWiredCall('runs', 'start'),
  hibernate: () => notWiredCall('runs', 'hibernate'),
  resume: () => notWiredCall('runs', 'resume'),
  stop: () => notWiredCall('runs', 'stop'),
  status: () => notWiredCall('runs', 'status'),
};
