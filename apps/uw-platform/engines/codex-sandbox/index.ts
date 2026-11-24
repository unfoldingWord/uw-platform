import type { EngineConfig } from '../config.ts';
import { sandboxWork } from '../sandbox/run.ts';
import type { EngineAdapter } from '../seam.ts';
import { codexPlan } from './work.ts';

export function codexSandboxEngine(config: EngineConfig): EngineAdapter {
  const plan = codexPlan(config);
  return { key: 'codex-sandbox', turn: null, work: (input) => sandboxWork(config, plan, input) };
}
