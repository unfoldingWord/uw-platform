import { notWiredCall } from '@uw/harness';
import type { EngineAdapter } from '../seam.ts';

export function claudeCodeSandboxEngine(): EngineAdapter {
  return {
    key: 'claude-code-sandbox',
    turn: null,
    work: () => notWiredCall('modelEngine', 'work'),
  };
}
