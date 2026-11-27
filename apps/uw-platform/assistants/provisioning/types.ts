import type { AssistantProvisioningFailure } from '@uw/contracts';
import type { Caller, Clock, Kernel } from '@uw/harness';
import type { Database } from '@uw/db/client';
import type { Directory } from '../google/directory.ts';
import type { ZulipProvisionDeps } from '../zulip/provision.ts';

export type WorkspaceSide = {
  readonly directory: Directory;
  readonly domain: string;
  readonly unit: string;
};

export type ProvisionerDeps = {
  readonly db: Database;
  readonly kernel: Kernel;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly caller: Caller;
  readonly workspace: WorkspaceSide | null;
  readonly zulip: ZulipProvisionDeps | null;
};

export type StepOutcome =
  | { readonly kind: 'done' }
  | { readonly kind: 'waiting' }
  | { readonly kind: 'failed'; readonly why: AssistantProvisioningFailure };

export const done: StepOutcome = { kind: 'done' };

export function failed(why: AssistantProvisioningFailure): StepOutcome {
  return { kind: 'failed', why };
}
