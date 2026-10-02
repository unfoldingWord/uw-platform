import type { JWTVerifyGetKey } from 'jose';
import type { Logger, LogSink } from '@uw/core/log';
import type { Principal } from '@uw/core/principal';
import type { Clock } from '@uw/harness';
import { remoteAccessKeys, type AccessConfig, type AccessIdentity } from './auth/access.ts';
import { hyperdriveDatabase, type DatabaseHandle } from './database.ts';
import type { Bindings } from './env.ts';
import { systemClock } from './ports/clock.ts';

export type AppDeps = {
  readonly openDatabase: (env: Bindings) => DatabaseHandle | null;
  readonly accessKeys: (config: AccessConfig) => JWTVerifyGetKey;
  readonly newId: () => string;
  readonly sink: LogSink;
  readonly clock: Clock;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    traceId: string;
    now: Date;
    logger: Logger;
    database: DatabaseHandle | null;
    principal: Principal | null;
    access: AccessIdentity | null;
    outcome: string | null;
  };
};

export const platformDeps: AppDeps = {
  openDatabase: hyperdriveDatabase,
  accessKeys: remoteAccessKeys,
  newId: () => crypto.randomUUID(),
  sink: (line) => console.log(line),
  clock: systemClock,
};
