import { EngineNotAvailableError } from '@uw/harness';
import type { EngineAdapter } from '../seam.ts';

export function claudeManagedAgentEngine(): EngineAdapter {
  return {
    key: 'claude-managed-agent',
    turn: null,
    work: () => Promise.reject(new EngineNotAvailableError('claude-managed-agent')),
  };
}
