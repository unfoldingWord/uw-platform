import type { LogSink, Logger } from '@uw/core/log';
import { hyperdriveLedger, type LedgerHandle } from './deliveries/ledger.ts';
import type { IngestBindings } from './env.ts';

export type IngestDeps = {
  readonly openLedger: (env: IngestBindings) => LedgerHandle | null;
  readonly newId: () => string;
  readonly now: () => Date;
  readonly sink: LogSink;
};

export type IngestEnv = {
  Bindings: IngestBindings;
  Variables: { traceId: string; logger: Logger; outcome: string | null };
};

export const platformIngestDeps: IngestDeps = {
  openLedger: hyperdriveLedger,
  newId: () => crypto.randomUUID(),
  now: () => new Date(),
  sink: (line) => console.log(line),
};
