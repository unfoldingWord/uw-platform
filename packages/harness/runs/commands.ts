import { isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { refused, type KernelOutcome } from '../outcome.ts';
import type { Ports, RunRow } from '../ports.ts';
import { beat, type BeatInput, type Beaten } from './beat.ts';
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
  beat(caller: Caller, input: BeatInput): Promise<KernelOutcome<Beaten>>;
};

type HostMember<A extends readonly unknown[], R> = (
  caller: Caller,
  ...args: A
) => Promise<KernelOutcome<R>>;

function hostOnly<A extends readonly unknown[], R>(member: HostMember<A, R>): HostMember<A, R> {
  return (caller, ...args) => {
    if (isSystemPrincipal(caller.actor)) return member(caller, ...args);
    return Promise.resolve(refused('not_permitted', { actor: caller.actor.identity }));
  };
}

export function createRunCommands(ports: RunPorts): RunCommands {
  return {
    start: (caller, input) => startRun(ports, caller, input),
    scene: hostOnly((caller, runId: string) => runScene(ports, caller, runId)),
    hibernateAtGate: hostOnly((caller, runId: string) => hibernateAtGate(ports, caller, runId)),
    complete: hostOnly((caller, runId: string, input: CompleteInput) =>
      complete(ports, caller, runId, input),
    ),
    fail: hostOnly((caller, runId: string, input: FailInput) => fail(ports, caller, runId, input)),
    holdPremise: hostOnly((caller, runId: string, input: { readonly reason: string }) =>
      holdPremise(ports, caller, runId, input),
    ),
    halt: hostOnly((caller, runId: string, why: HaltReason) => halt(ports, caller, runId, why)),
    stop: (caller, input) => stop(ports, caller, input),
    prompt: (caller, input) => prompt(ports, caller, input),
    beat: hostOnly((caller, input: BeatInput) => beat(ports, caller, input)),
  };
}
