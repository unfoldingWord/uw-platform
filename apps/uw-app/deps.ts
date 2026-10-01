import type { Logger, LogSink } from '@uw/core/log';
import type { Principal } from '@uw/core/principal';
import { hyperdriveDatabase, type DatabaseHandle } from './database.ts';
import type { Bindings } from './env.ts';

export type AppDeps = {
  readonly openDatabase: (env: Bindings) => DatabaseHandle | null;
  readonly newId: () => string;
  readonly sink: LogSink;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    traceId: string;
    logger: Logger;
    database: DatabaseHandle | null;
    principal: Principal | null;
    outcome: string | null;
  };
};

export const platformDeps: AppDeps = {
  openDatabase: hyperdriveDatabase,
  newId: () => crypto.randomUUID(),
  sink: (line) => console.log(line),
};
