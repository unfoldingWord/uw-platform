import type { ItemState } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { accepted, type KernelOutcome } from '../outcome.ts';
import type { MeasurementRow, Ports } from '../ports.ts';
import type { ImportTarget } from '../items/import.ts';
import { pollQueue, type PollInput, type PollItem } from './poll.ts';
import { importTarget, issueImported } from './repository.ts';
import { zulipTarget, type ZulipTarget } from './zulip-target.ts';
import {
  delegationHarness,
  type DelegationScene,
  harnessScene,
  itemScene,
  itemsInStage,
  type HarnessScene,
  type ItemScene,
  type StageItemsInput,
} from './scene.ts';

type ReadOptions = { readonly at: Date };

const MEASUREMENT_LIMIT = 50;

function byId(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

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
  delegation(
    caller: Caller,
    input: { readonly delegationId: string },
    options?: ReadOptions,
  ): Promise<KernelOutcome<DelegationScene>>;
  inStage(
    caller: Caller,
    input: StageItemsInput,
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
  issueImported(
    caller: Caller,
    input: { readonly githubId: number },
  ): Promise<KernelOutcome<boolean>>;
  zulipTarget(
    caller: Caller,
    input: { readonly topic: string },
  ): Promise<KernelOutcome<ZulipTarget>>;
  measurements(
    caller: Caller,
    input: { readonly itemId: string },
    options?: ReadOptions,
  ): Promise<KernelOutcome<readonly MeasurementRow[]>>;
  namesInstructions(input: { readonly pageId: string }): Promise<boolean>;
  harnessIdsForHealth(): Promise<readonly string[]>;
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
    delegation: (caller, input, options) => {
      const at = instant(options);
      return ports.store.transaction((tx) =>
        delegationHarness(ports, tx, caller, input.delegationId, at),
      );
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
    issueImported: (caller, input) =>
      ports.store.transaction((tx) => issueImported(tx, caller, input.githubId)),
    zulipTarget: (caller, input) =>
      ports.store.transaction((tx) => zulipTarget(tx, caller, input.topic)),
    measurements: (caller, input, options) => {
      const at = instant(options);
      return ports.store.transaction(async (tx) => {
        const scene = await itemScene(ports, tx, caller, input.itemId, at);
        if (scene.status !== 'accepted') return scene;
        return accepted(await tx.measurements.read.forItem(input.itemId, MEASUREMENT_LIMIT));
      });
    },
    namesInstructions: (input) =>
      ports.store.transaction((tx) => tx.harnessStages.read.namesInstructions(input.pageId)),
    harnessIdsForHealth: () =>
      ports.store.transaction(async (tx) =>
        (await tx.harnesses.read.list()).map((harness) => harness.id).sort(byId),
      ),
  };
}
