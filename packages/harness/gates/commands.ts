import type { Caller } from '../caller.ts';
import type { KernelOutcome } from '../outcome.ts';
import { decide, type Decided, type DecideInput, type GatePorts } from './decide.ts';

export type GateCommands = {
  decide(caller: Caller, input: DecideInput): Promise<KernelOutcome<Decided>>;
};

export function createGateCommands(ports: GatePorts): GateCommands {
  return { decide: (caller, input) => decide(ports, caller, input) };
}
