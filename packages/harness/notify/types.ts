import type { Grant } from '@uw/contracts';

export type PushDecision =
  'sent' | 'coalesced' | 'suppressed' | 'no_device' | 'dropped' | 'not_configured';
export type ZulipDecision = 'posted' | 'not_posted' | 'dropped' | 'not_configured';
export type WakeDelivery = {
  readonly push: readonly { readonly personId: string; readonly decision: PushDecision }[];
  readonly zulip: ZulipDecision;
};
export type GrantHolder = {
  readonly personId: string;
  readonly email: string;
  readonly grants: readonly Grant[];
};
