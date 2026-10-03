import type { Caller } from '../caller.ts';
import type { KernelOutcome } from '../outcome.ts';
import { decide, type Decided, type DecideInput, type GatePorts } from './decide.ts';
import { recoverConnectors, type Recovered } from './recover.ts';

export type GateCommands = {
  decide(caller: Caller, input: DecideInput): Promise<KernelOutcome<Decided>>;
  recoverConnectors(
    caller: Caller,
    input: { readonly harnessId: string },
  ): Promise<KernelOutcome<Recovered>>;
};

export function createGateCommands(ports: GatePorts): GateCommands {
  return {
    decide: (caller, input) => decide(ports, caller, input),
    recoverConnectors: (caller, input) => recoverConnectors(ports, caller, input),
  };
}
