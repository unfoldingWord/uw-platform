import type { Caller } from '../caller.ts';
import type { KernelOutcome } from '../outcome.ts';
import type { Ports, RunRow } from '../ports.ts';
import { prompt, stop, type PromptInput, type StopInput } from './control.ts';
import {
  complete,
  fail,
  halt,
  hibernateAtGate,
  holdPremise,
  type CompleteInput,
  type FailInput,
  type HaltReason,
} from './lifecycle.ts';
import { runScene } from './scene.ts';
import { startRun } from './start.ts';
import type { RunScene, StartedRun, StartRunInput } from './types.ts';

type RunPorts = Pick<Ports, 'clock' | 'githubFacts' | 'grants' | 'ids' | 'store' | 'runs'>;

type RunOutcome = Promise<KernelOutcome<RunRow>>;

export type RunCommands = {
  start(caller: Caller, input: StartRunInput): Promise<KernelOutcome<StartedRun>>;
  scene(caller: Caller, runId: string): Promise<KernelOutcome<RunScene>>;
  hibernateAtGate(caller: Caller, runId: string): RunOutcome;
  complete(caller: Caller, runId: string, input: CompleteInput): RunOutcome;
  fail(caller: Caller, runId: string, input: FailInput): RunOutcome;
  holdPremise(caller: Caller, runId: string, input: { readonly reason: string }): RunOutcome;
  halt(caller: Caller, runId: string, why: HaltReason): RunOutcome;
  stop(caller: Caller, input: StopInput): RunOutcome;
  prompt(caller: Caller, input: PromptInput): RunOutcome;
};

export function createRunCommands(ports: RunPorts): RunCommands {
  return {
    start: (caller, input) => startRun(ports, caller, input),
    scene: (caller, runId) => runScene(ports, caller, runId),
    hibernateAtGate: (caller, runId) => hibernateAtGate(ports, caller, runId),
    complete: (caller, runId, input) => complete(ports, caller, runId, input),
    fail: (caller, runId, input) => fail(ports, caller, runId, input),
    holdPremise: (caller, runId, input) => holdPremise(ports, caller, runId, input),
    halt: (caller, runId, why) => halt(ports, caller, runId, why),
    stop: (caller, input) => stop(ports, caller, input),
    prompt: (caller, input) => prompt(ports, caller, input),
  };
}
