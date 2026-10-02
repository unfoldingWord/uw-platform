import type { ItemState } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import type { KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { enqueue, type EnqueueInput } from './enqueue.ts';

type ItemPorts = Pick<Ports, 'clock' | 'ids' | 'store'>;

export type ItemCommands = {
  enqueue(caller: Caller, input: EnqueueInput): Promise<KernelOutcome<ItemState>>;
};

export function createItemCommands(ports: ItemPorts): ItemCommands {
  return { enqueue: (caller, input) => enqueue(ports, caller, input) };
}
