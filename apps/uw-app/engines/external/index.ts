import { EngineNotAvailableError } from '@uw/harness';
import type { EngineAdapter } from '../seam.ts';

export function externalEngine(): EngineAdapter {
  return {
    key: 'external',
    turn: null,
    work: () => Promise.reject(new EngineNotAvailableError('external')),
  };
}
