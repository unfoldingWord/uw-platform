import { notWiredCall, type Research } from '@uw/harness';

export const researchNotWired: Research = {
  search: () => notWiredCall('research', 'search'),
  read: () => notWiredCall('research', 'read'),
  flights: () => notWiredCall('research', 'flights'),
};
