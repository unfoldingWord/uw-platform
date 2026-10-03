import { EngineNotAvailableError, notWiredCall, type ModelEngine } from '@uw/harness';
import type { EngineRegistry } from '../engines/registry.ts';

export type SpendReader = ModelEngine['spend'];

export const spendNotWired: SpendReader = () => notWiredCall('modelEngine', 'spend');

export function platformModelEngine(registry: EngineRegistry, spend: SpendReader): ModelEngine {
  return {
    turn: async (request) => {
      const turn = registry.get(request.engine)?.turn ?? null;
      if (turn === null) throw new EngineNotAvailableError(request.engine);
      return turn(request);
    },
    spend: (since) => spend(since),
  };
}
