import type { Caller } from '../caller.ts';
import type { KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { runScene } from './scene.ts';
import { startRun } from './start.ts';
import type { RunScene, StartedRun, StartRunInput } from './types.ts';

type RunPorts = Pick<Ports, 'clock' | 'githubFacts' | 'grants' | 'ids' | 'store' | 'runs'>;

export type RunCommands = {
  start(caller: Caller, input: StartRunInput): Promise<KernelOutcome<StartedRun>>;
  scene(caller: Caller, runId: string): Promise<KernelOutcome<RunScene>>;
};

export function createRunCommands(ports: RunPorts): RunCommands {
  return {
    start: (caller, input) => startRun(ports, caller, input),
    scene: (caller, runId) => runScene(ports, caller, runId),
  };
}
