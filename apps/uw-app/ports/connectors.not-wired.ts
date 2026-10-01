import { notWiredCall, type Connectors } from '@uw/harness';

export const connectorsNotWired: Connectors = {
  run: () => notWiredCall('connectors', 'run'),
};
