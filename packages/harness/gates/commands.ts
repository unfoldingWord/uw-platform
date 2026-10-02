import type { Caller } from '../caller.ts';
import type { KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { decide, type Decided, type DecideInput } from './decide.ts';

type GatePorts = Pick<Ports, 'clock' | 'connectors' | 'githubFacts' | 'grants' | 'ids' | 'store'>;

export type GateCommands = {
  decide(caller: Caller, input: DecideInput): Promise<KernelOutcome<Decided>>;
};

export function createGateCommands(ports: GatePorts): GateCommands {
  return { decide: (caller, input) => decide(ports, caller, input) };
}
