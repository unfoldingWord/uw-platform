import type { ItemState } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import type { KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import { pollQueue, type PollInput, type PollItem } from './poll.ts';
import {
  harnessScene,
  itemScene,
  itemsInStage,
  type HarnessScene,
  type ItemScene,
} from './scene.ts';

export type KernelReads = {
  harness(
    caller: Caller,
    input: { readonly harnessId: string },
  ): Promise<KernelOutcome<HarnessScene>>;
  item(caller: Caller, input: { readonly itemId: string }): Promise<KernelOutcome<ItemScene>>;
  inStage(
    caller: Caller,
    input: { readonly harnessId: string; readonly stageKey: string },
  ): Promise<KernelOutcome<readonly ItemState[]>>;
  poll(caller: Caller, input: PollInput): Promise<KernelOutcome<readonly PollItem[]>>;
};

type ReadPorts = Pick<Ports, 'clock' | 'grants' | 'store'>;

export function createKernelReads(ports: ReadPorts): KernelReads {
  return {
    harness: (caller, input) => {
      const at = ports.clock.now();
      return ports.store.transaction((tx) => harnessScene(tx, caller, input.harnessId, at));
    },
    item: (caller, input) => {
      const at = ports.clock.now();
      return ports.store.transaction((tx) => itemScene(tx, caller, input.itemId, at));
    },
    inStage: (caller, input) => {
      const at = ports.clock.now();
      return ports.store.transaction((tx) => itemsInStage(tx, caller, input, at));
    },
    poll: (caller, input) => {
      const at = ports.clock.now();
      return ports.store.transaction((tx) => pollQueue(ports, tx, caller.actor, input, at));
    },
  };
}
