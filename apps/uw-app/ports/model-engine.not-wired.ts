import { notWiredCall, type ModelEngine } from '@uw/harness';

export const modelEngineNotWired: ModelEngine = {
  turn: () => notWiredCall('modelEngine', 'turn'),
};
