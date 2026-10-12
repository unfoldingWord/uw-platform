import type { Principal } from '@uw/contracts';
import type { Logger } from '@uw/core/log';
import type { Database } from '@uw/db/client';
import type { Caller, Kernel } from '@uw/harness';
import type { SpendCap } from '../health/spend-cap.ts';

export type McpHost = 'external' | 'workflow';

export type VerbContext = {
  readonly principal: Principal;
  readonly host: McpHost;
  readonly at: Date;
  readonly traceId: string;
  readonly kernel: Kernel;
  readonly db: Database;
  readonly commit: string;
  readonly cap: SpendCap;
  readonly logger: Logger;
};

export function callerOf(context: VerbContext): Caller {
  return { actor: context.principal, traceId: context.traceId };
}
