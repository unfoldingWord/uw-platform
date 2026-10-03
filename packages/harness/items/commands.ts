import type { ItemState } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import type { KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import type { RunStepInput } from '../runs/types.ts';
import { claim, type Claimed, type ClaimInput } from './claim.ts';
import { enqueue, type EnqueueInput } from './enqueue.ts';
import {
  importIssue,
  labelRemoved,
  type Imported,
  type ImportIssueInput,
  type LabelRemoved,
  type LabelRemovedInput,
} from './import.ts';
import {
  attachLearning,
  markNothingLearned,
  type AttachLearningInput,
  type NothingLearnedInput,
} from './learning.ts';
import { reorder, type ReorderInput } from './reorder.ts';
import { release, type ReleaseInput } from './release.ts';
import { submit, type Submitted, type SubmitInput } from './submit.ts';
import {
  expireLeases,
  recordRunStep,
  renewLease,
  type LeaseOutcome,
  type RenewInput,
  type StepOutcome,
  type SweepInput,
  type Swept,
} from './run-steps.ts';

type ItemPorts = Pick<Ports, 'clock' | 'githubFacts' | 'grants' | 'ids' | 'store' | 'runs'>;

export type ItemCommands = {
  enqueue(caller: Caller, input: EnqueueInput): Promise<KernelOutcome<ItemState>>;
  importIssue(caller: Caller, input: ImportIssueInput): Promise<KernelOutcome<Imported>>;
  labelRemoved(caller: Caller, input: LabelRemovedInput): Promise<KernelOutcome<LabelRemoved>>;
  claim(caller: Caller, input: ClaimInput): Promise<KernelOutcome<Claimed>>;
  release(caller: Caller, input: ReleaseInput): Promise<KernelOutcome<ItemState>>;
  reorder(caller: Caller, input: ReorderInput): Promise<KernelOutcome<readonly ItemState[]>>;
  renewLease(caller: Caller, input: RenewInput): Promise<KernelOutcome<LeaseOutcome>>;
  recordRunStep(caller: Caller, input: RunStepInput): Promise<KernelOutcome<StepOutcome>>;
  expireLeases(caller: Caller, input: SweepInput): Promise<KernelOutcome<Swept>>;
  submit(caller: Caller, input: SubmitInput): Promise<KernelOutcome<Submitted>>;
  attachLearning(caller: Caller, input: AttachLearningInput): Promise<KernelOutcome<ItemState>>;
  markNothingLearned(caller: Caller, input: NothingLearnedInput): Promise<KernelOutcome<ItemState>>;
};

export function createItemCommands(ports: ItemPorts): ItemCommands {
  return {
    enqueue: (caller, input) => enqueue(ports, caller, input),
    importIssue: (caller, input) => importIssue(ports, caller, input),
    labelRemoved: (caller, input) => labelRemoved(ports, caller, input),
    claim: (caller, input) => claim(ports, caller, input),
    release: (caller, input) => release(ports, caller, input),
    reorder: (caller, input) => reorder(ports, caller, input),
    renewLease: (caller, input) => renewLease(ports, caller, input),
    recordRunStep: (caller, input) => recordRunStep(ports, caller, input),
    expireLeases: (caller, input) => expireLeases(ports, caller, input),
    submit: (caller, input) => submit(ports, caller, input),
    attachLearning: (caller, input) => attachLearning(ports, caller, input),
    markNothingLearned: (caller, input) => markNothingLearned(ports, caller, input),
  };
}
