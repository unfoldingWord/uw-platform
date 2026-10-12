import type { ErrorReason } from '@uw/contracts';

export type Detail = Readonly<Record<string, string | number | boolean | null | readonly string[]>>;
export type Accepted<T> = { readonly status: 'accepted'; readonly value: T };
export type Refused = {
  readonly status: 'error';
  readonly reason: ErrorReason;
  readonly detail: Detail;
};
export type KernelOutcome<T> = Accepted<T> | Refused;

export function accepted<T>(value: T): Accepted<T> {
  return { status: 'accepted', value };
}

export function refused(reason: ErrorReason, detail: Detail = {}): Refused {
  return { status: 'error', reason, detail };
}
