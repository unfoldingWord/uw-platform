import type { ItemState } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import type { KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import type { ImportTarget } from '../items/import.ts';
import { pollQueue, type PollInput, type PollItem } from './poll.ts';
import { importTarget } from './repository.ts';
import {
  harnessScene,
  itemScene,
  itemsInStage,
  type HarnessScene,
  type ItemScene,
} from './scene.ts';

type ReadOptions = { readonly at: Date };

export type KernelReads = {
  harness(
    caller: Caller,
    input: { readonly harnessId: string },
    options?: ReadOptions,
  ): Promise<KernelOutcome<HarnessScene>>;
  item(
    caller: Caller,
    input: { readonly itemId: string },
    options?: ReadOptions,
  ): Promise<KernelOutcome<ItemScene>>;
  inStage(
    caller: Caller,
    input: { readonly harnessId: string; readonly stageKey: string },
    options?: ReadOptions,
  ): Promise<KernelOutcome<readonly ItemState[]>>;
  poll(
    caller: Caller,
    input: PollInput,
    options?: ReadOptions,
  ): Promise<KernelOutcome<readonly PollItem[]>>;
  importTarget(
    caller: Caller,
    input: { readonly repository: string },
    options?: ReadOptions,
  ): Promise<KernelOutcome<ImportTarget>>;
  namesInstructions(input: { readonly pageId: string }): Promise<boolean>;
};

type ReadPorts = Pick<Ports, 'clock' | 'grants' | 'store'>;

export function createKernelReads(ports: ReadPorts): KernelReads {
  const instant = (options?: ReadOptions): Date => options?.at ?? ports.clock.now();
  return {
    harness: (caller, input, options) => {
      const at = instant(options);
      return ports.store.transaction((tx) => harnessScene(ports, tx, caller, input.harnessId, at));
    },
    item: (caller, input, options) => {
      const at = instant(options);
      return ports.store.transaction((tx) => itemScene(ports, tx, caller, input.itemId, at));
    },
    inStage: (caller, input, options) => {
      const at = instant(options);
      return ports.store.transaction((tx) => itemsInStage(ports, tx, caller, input, at));
    },
    poll: (caller, input, options) => {
      const at = instant(options);
      return ports.store.transaction((tx) => pollQueue(ports, tx, caller.actor, input, at));
    },
    importTarget: (caller, input, options) => {
      const at = instant(options);
      return ports.store.transaction((tx) => importTarget(ports, tx, caller, input.repository, at));
    },
    namesInstructions: (input) =>
      ports.store.transaction((tx) => tx.harnessStages.read.namesInstructions(input.pageId)),
  };
}
