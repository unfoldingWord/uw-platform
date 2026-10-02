import type { ItemState } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import type { KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { claim, release, type Claimed, type ClaimInput } from './claim.ts';
import { enqueue, type EnqueueInput } from './enqueue.ts';

type ItemPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type ItemCommands = {
  enqueue(caller: Caller, input: EnqueueInput): Promise<KernelOutcome<ItemState>>;
  claim(caller: Caller, input: ClaimInput): Promise<KernelOutcome<Claimed>>;
  release(caller: Caller, input: { readonly itemId: string }): Promise<KernelOutcome<ItemState>>;
};

export function createItemCommands(ports: ItemPorts): ItemCommands {
  return {
    enqueue: (caller, input) => enqueue(ports, caller, input),
    claim: (caller, input) => claim(ports, caller, input),
    release: (caller, input) => release(ports, caller, input),
  };
}
