import type { EngineConfig } from '../config.ts';
import { sandboxWork } from '../sandbox/run.ts';
import type { EngineAdapter } from '../seam.ts';
import { claudeCodePlan } from './work.ts';

export function claudeCodeSandboxEngine(config: EngineConfig): EngineAdapter {
  const plan = claudeCodePlan(config);
  return {
    key: 'claude-code-sandbox',
    turn: null,
    work: (input) => sandboxWork(config, plan, input),
  };
}
