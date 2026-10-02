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
export type VerbReply<N extends VerbName> =
  { readonly status: 'accepted'; readonly output: VerbOutput<N> } | VerbRefusal;

export type Found<S> = { readonly resource: AclResource; readonly found: S };

export type GatedHandler<N extends VerbName, S = unknown> = {
  readonly kind: 'gated';
  readonly name: N;
  hidden(input: VerbInput<N>): VerbRefusal;
  resource(context: VerbContext, input: VerbInput<N>): Promise<Found<S> | VerbRefusal>;
  run(context: VerbContext, input: VerbInput<N>, found: S): Promise<VerbReply<N>>;
};

export type RowFilteredHandler<N extends VerbName> = {
  readonly kind: 'rows';
  readonly name: N;
  run(context: VerbContext, input: VerbInput<N>): Promise<VerbReply<N>>;
};

export type VerbHandler = GatedHandler<VerbName> | RowFilteredHandler<VerbName>;

export function gatedHandler<N extends VerbName, S>(
  handler: Omit<GatedHandler<N, S>, 'kind'>,
): GatedHandler<N, S> {
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

export function fromKernel<T, O>(
  outcome: KernelOutcome<T>,
  output: (value: T) => O,
): { readonly status: 'accepted'; readonly output: O } | VerbRefusal {
  if (outcome.status === 'error') return refusal(outcome.reason, outcome.detail);
  return { status: 'accepted', output: output(outcome.value) };
}
