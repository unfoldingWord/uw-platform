import { createLogger, type Logger, type LogSink } from '@uw/core/log';
import { systemPrincipal } from '@uw/core/principal';
import type { Bindings } from '../env.ts';

export type CronDeps = {
  readonly now: () => Date;
  readonly fetch: typeof fetch;
  readonly sink: LogSink;
  readonly newId: () => string;
  readonly commit: string;
};

export type CronJob = (env: Bindings, deps: CronDeps) => Promise<void>;

export function cronLogger(deps: CronDeps, route: string): Logger {
  return createLogger(
    {
      traceId: deps.newId(),
      commit: deps.commit,
      route,
      principal: systemPrincipal().identity,
    },
    deps.sink,
  );
}
