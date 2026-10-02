import type { z } from 'zod';
import type { ErrorReason, VerbName, verbIo } from '@uw/contracts';
import type { AclResource } from '@uw/core/acl';
import type { Detail, KernelOutcome } from '@uw/harness';
import type { VerbContext } from './context.ts';

export type VerbInput<N extends VerbName> = z.infer<(typeof verbIo)[N]['input']>;
type VerbOutput<N extends VerbName> = z.infer<(typeof verbIo)[N]['output']>;
export type VerbRefusal = {
  readonly status: 'error';
  readonly reason: ErrorReason;
  readonly detail: Detail;
};
type VerbReply<N extends VerbName> =
  { readonly status: 'accepted'; readonly output: VerbOutput<N> } | VerbRefusal;

export type GatedHandler<N extends VerbName> = {
  readonly kind: 'gated';
  readonly name: N;
  readonly hiddenAs: ErrorReason;
  resource(context: VerbContext, input: VerbInput<N>): Promise<AclResource | VerbRefusal>;
  run(context: VerbContext, input: VerbInput<N>): Promise<VerbReply<N>>;
};

export type RowFilteredHandler<N extends VerbName> = {
  readonly kind: 'rows';
  readonly name: N;
  run(context: VerbContext, input: VerbInput<N>): Promise<VerbReply<N>>;
};

export type VerbHandler = GatedHandler<VerbName> | RowFilteredHandler<VerbName>;

export function gatedHandler<N extends VerbName>(
  handler: Omit<GatedHandler<N>, 'kind'>,
): GatedHandler<N> {
  return { ...handler, kind: 'gated' };
}

export function rowFilteredHandler<N extends VerbName>(
  handler: Omit<RowFilteredHandler<N>, 'kind'>,
): RowFilteredHandler<N> {
  return { ...handler, kind: 'rows' };
}

export function refusal(reason: ErrorReason, detail: Detail = {}): VerbRefusal {
  return { status: 'error', reason, detail };
}

export function fromKernel<T, N extends VerbName>(
  outcome: KernelOutcome<T>,
  output: (value: T) => VerbOutput<N>,
): VerbReply<N> {
  if (outcome.status === 'error') return refusal(outcome.reason, outcome.detail);
  return { status: 'accepted', output: output(outcome.value) };
}
