import type { GateView, ItemState } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import type { KernelOutcome } from '../outcome.ts';
import { decide, type Decided, type DecideInput, type GatePorts } from './decide.ts';
import { decideGates, type BatchDecided, type BatchInput } from './decide-batch.ts';
import { resumeRunsWhere } from '../runs/resume.ts';
import type { RunRow, StoreTransaction } from '../ports.ts';
import { recoverConnectors, type Recovered } from './recover.ts';
import { recordShadowVerdicts, type ShadowInput } from './shadow.ts';
import { gateView } from './view.ts';

export type GateCommands = {
  decide(caller: Caller, input: DecideInput): Promise<KernelOutcome<Decided>>;
  decideGates(caller: Caller, input: BatchInput): Promise<KernelOutcome<BatchDecided>>;
  view(
    caller: Caller,
    input: { readonly itemId: string },
    options?: { readonly at: Date },
  ): Promise<KernelOutcome<GateView>>;
  recoverConnectors(
    caller: Caller,
    input: { readonly harnessId: string },
  ): Promise<KernelOutcome<Recovered>>;
  recordShadowVerdicts(
    caller: Caller,
    input: ShadowInput,
  ): Promise<KernelOutcome<readonly ItemState[]>>;
};

function gateWaiting(itemId: string) {
  return async (tx: StoreTransaction): Promise<readonly RunRow[]> => {
    const run = await tx.harnessRuns.read.liveForItem(itemId);
    return run?.hibernatedFor === 'gate' ? [run] : [];
  };
}

async function decideAndResume(
  ports: GatePorts,
  caller: Caller,
  input: DecideInput,
): Promise<KernelOutcome<Decided>> {
  const outcome = await decide(ports, caller, input);
  if (outcome.status === 'accepted') {
    await resumeRunsWhere(ports, gateWaiting(input.itemId), 'gate');
  }
  return outcome;
}

async function decideGatesAndResume(
  ports: GatePorts,
  caller: Caller,
  input: BatchInput,
): Promise<KernelOutcome<BatchDecided>> {
  const outcome = await decideGates(ports, caller, input);
  if (outcome.status !== 'accepted') return outcome;
  for (const one of outcome.value.decided) {
    await resumeRunsWhere(ports, gateWaiting(one.item.itemId), 'gate');
  }
  return outcome;
}

export function createGateCommands(ports: GatePorts): GateCommands {
  return {
    decide: (caller, input) => decideAndResume(ports, caller, input),
    decideGates: (caller, input) => decideGatesAndResume(ports, caller, input),
    view: (caller, input, options) => gateView(ports, caller, input, options),
    recoverConnectors: (caller, input) => recoverConnectors(ports, caller, input),
    recordShadowVerdicts: (caller, input) => recordShadowVerdicts(ports, caller, input),
  };
}
