import { createLogger, type Logger, type LogSink } from '@uw/core/log';
import { commitOf, type Bindings } from '../env.ts';
import { hyperdriveDatabase, type DatabaseHandle } from '../database.ts';
import { githubAppOf } from '../github/app-config.ts';
import { githubClient, type GitHubClient } from '../github/deps.ts';
import { githubIngestHandler } from '../github/ingest.ts';
import { platformGitHubTransport } from '../github/transport.ts';
import { hubWiring, platformKernel } from '../kernel.ts';
import { systemClock } from '../ports/clock.ts';
import { hubOf } from '../ports/hub.ts';
import { unitHub, type UnitHub } from '../unit-hub.ts';
import {
  batchTraceId,
  consumeBatch,
  notWiredHandlers,
  QUEUE_ROUTE,
  type IngestHandler,
} from './consumer.ts';
import { postgresWatermarks } from './watermarks.ts';

function clientOf(env: Bindings, now: () => Date): GitHubClient | null {
  const config = githubAppOf(env);
  if (config === null) return null;
  return githubClient(config, platformGitHubTransport(now));
}

function handlersFor(
  database: DatabaseHandle | null,
  env: Bindings,
  now: () => Date,
  unit: UnitHub,
) {
  if (database === null) return notWiredHandlers;
  const client = clientOf(env, now);
  const kernel = platformKernel(database, systemClock, hubWiring(unit.hub));
  return new Map<'github', IngestHandler>([
    ['github', githubIngestHandler({ db: database.db, kernel, client, now })],
  ]);
}

function hubLogger(env: Bindings, sink: LogSink, batch: MessageBatch<unknown>): Logger {
  const traceId = batchTraceId(batch.messages, () => crypto.randomUUID());
  return createLogger(
    { traceId, commit: commitOf(env), route: QUEUE_ROUTE, principal: null },
    sink,
  );
}

export async function consumeIngestBatch(
  batch: MessageBatch<unknown>,
  env: Bindings,
): Promise<void> {
  const database = hyperdriveDatabase(env);
  const now = () => new Date();
  const sink = (line: string) => console.log(line);
  const unit = unitHub(hubOf(env, hubLogger(env, sink, batch)));
  try {
    await consumeBatch(batch.messages, {
      handlers: handlersFor(database, env, now, unit),
      deadLetter: env.INGEST_DLQ ?? null,
      watermarks: database ? postgresWatermarks(database.db) : null,
      sink,
      commit: commitOf(env),
      newId: () => crypto.randomUUID(),
      now,
    });
  } finally {
    await unit.flush();
    await database?.release();
  }
}
