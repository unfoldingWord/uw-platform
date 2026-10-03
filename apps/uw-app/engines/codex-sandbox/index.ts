import { notWiredCall } from '@uw/harness';
import type { EngineAdapter } from '../seam.ts';

export function codexSandboxEngine(): EngineAdapter {
  return { key: 'codex-sandbox', turn: null, work: () => notWiredCall('modelEngine', 'work') };
}
