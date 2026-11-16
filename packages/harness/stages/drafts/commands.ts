import type { Stage } from '@uw/contracts';
import type { Caller } from '../../caller.ts';
import type { KernelOutcome } from '../../outcome.ts';
import type { WorkflowDraftRow } from '../../store-ports.ts';
import type { DraftPorts } from './access.ts';
import { lockCommands, type DraftInput, type SaveInput, type TakeOverInput } from './lock.ts';
import { publishDraft, type PublishInput } from './publish.ts';

export type DraftCommands = {
  open(caller: Caller, input: DraftInput): Promise<KernelOutcome<WorkflowDraftRow>>;
  save(caller: Caller, input: SaveInput): Promise<KernelOutcome<WorkflowDraftRow>>;
  takeOver(caller: Caller, input: TakeOverInput): Promise<KernelOutcome<WorkflowDraftRow>>;
  discard(caller: Caller, input: DraftInput): Promise<KernelOutcome<null>>;
  publish(caller: Caller, input: PublishInput): Promise<KernelOutcome<readonly Stage[]>>;
};

export function createDraftCommands(ports: DraftPorts): DraftCommands {
  return {
    ...lockCommands(ports),
    publish: (caller, input) => publishDraft(ports, caller, input),
  };
}
