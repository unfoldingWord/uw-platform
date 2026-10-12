import type { Principal } from '@uw/contracts';

export type Caller = {
  readonly actor: Principal;
  readonly traceId: string;
  readonly requestId?: string | null;
};
