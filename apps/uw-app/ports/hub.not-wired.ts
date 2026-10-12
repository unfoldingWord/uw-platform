import { notWiredCall, type Hub } from '@uw/harness';

export const hubNotWired: Hub = {
  wake: () => notWiredCall('hub', 'wake'),
  present: () => notWiredCall('hub', 'present'),
};
