import type { z } from 'zod';
import type { ErrorReason, VerbName, verbIo } from '@uw/contracts';
import { can, type AclResource } from '@uw/core/acl';
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

type ResourceOf<R> = (row: R) => AclResource | null;

export type RowsSpec<N extends VerbName, R> = {
  readonly name: N;
  rows(context: VerbContext, input: VerbInput<N>): Promise<readonly R[] | VerbRefusal>;
  resources(context: VerbContext, input: VerbInput<N>, rows: readonly R[]): Promise<ResourceOf<R>>;
  reply(visible: readonly R[], input: VerbInput<N>): VerbReply<N>;
};

export type VerbHandler = GatedHandler<VerbName> | RowFilteredHandler<VerbName>;

const built = new WeakSet<object>();

function brand<H extends object>(handler: H): H {
  const frozen = Object.freeze(handler);
  built.add(frozen);
  return frozen;
}

export function isBuiltHandler(handler: object): boolean {
  return built.has(handler);
}

export function gatedHandler<N extends VerbName, S>(
  handler: Omit<GatedHandler<N, S>, 'kind'>,
): GatedHandler<N, S> {
  return brand({ ...handler, kind: 'gated' });
}

function isRows<R>(found: readonly R[] | VerbRefusal): found is readonly R[] {
  return Array.isArray(found);
}

function readable(context: VerbContext, resource: AclResource | null): boolean {
  return resource !== null && can(context.principal, 'read', resource, context.at);
}

export function rowFilteredHandler<N extends VerbName, R>(
  spec: RowsSpec<N, R>,
): RowFilteredHandler<N> {
  const { rows, resources, reply } = spec;
  return brand({
    kind: 'rows',
    name: spec.name,
    run: async (context: VerbContext, input: VerbInput<N>): Promise<VerbReply<N>> => {
      const found = await rows(context, input);
      if (!isRows(found)) return found;
      const resourceOf = await resources(context, input, found);
      return reply(
        found.filter((row) => readable(context, resourceOf(row))),
        input,
      );
    },
  });
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
