import { notWiredCall, type Grants } from '@uw/harness';

export const grantsNotWired: Grants = {
  resolve: () => notWiredCall('grants', 'resolve'),
  lockAndReread: () => notWiredCall('grants', 'lockAndReread'),
};
