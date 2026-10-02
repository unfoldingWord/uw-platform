import type { Principal } from '@uw/contracts';
import type { Logger } from '@uw/core/log';
import type { Database } from '@uw/db/client';
import type { Kernel } from '@uw/harness';

export type McpHost = 'external' | 'workflow';

export type VerbContext = {
  readonly principal: Principal;
  readonly host: McpHost;
  readonly at: Date;
  readonly traceId: string;
  readonly kernel: Kernel;
  readonly db: Database;
  readonly commit: string;
  readonly logger: Logger;
};
