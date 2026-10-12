import { notWiredCall, type Grants } from '@uw/harness';

export const grantsNotWired: Grants = {
  resolve: () => notWiredCall('grants', 'resolve'),
  resolveIn: () => notWiredCall('grants', 'resolveIn'),
  lockAndReread: () => notWiredCall('grants', 'lockAndReread'),
  holders: () => notWiredCall('grants', 'holders'),
};
