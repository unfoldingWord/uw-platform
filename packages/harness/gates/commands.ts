import type { GateView } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import type { KernelOutcome } from '../outcome.ts';
import { decide, type Decided, type DecideInput, type GatePorts } from './decide.ts';
import { recoverConnectors, type Recovered } from './recover.ts';
import { gateView } from './view.ts';

export type GateCommands = {
  decide(caller: Caller, input: DecideInput): Promise<KernelOutcome<Decided>>;
  view(
    caller: Caller,
    input: { readonly itemId: string },
    options?: { readonly at: Date },
  ): Promise<KernelOutcome<GateView>>;
  recoverConnectors(
    caller: Caller,
    input: { readonly harnessId: string },
  ): Promise<KernelOutcome<Recovered>>;
};

export function createGateCommands(ports: GatePorts): GateCommands {
  return {
    decide: (caller, input) => decide(ports, caller, input),
    view: (caller, input, options) => gateView(ports, caller, input, options),
    recoverConnectors: (caller, input) => recoverConnectors(ports, caller, input),
  };
}
