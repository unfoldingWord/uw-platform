import { commitOf, type Bindings } from '../env.ts';
import { hyperdriveDatabase, type DatabaseHandle } from '../database.ts';
import { githubAppOf } from '../github/app-config.ts';
import { githubClient, type GitHubClient } from '../github/deps.ts';
import { githubIngestHandler } from '../github/ingest.ts';
import { platformGitHubTransport } from '../github/transport.ts';
import { platformKernel } from '../kernel.ts';
import { consumeBatch, notWiredHandlers, type IngestHandler } from './consumer.ts';
import { postgresWatermarks } from './watermarks.ts';

function clientOf(env: Bindings, now: () => Date): GitHubClient | null {
  const config = githubAppOf(env);
  if (config === null) return null;
  return githubClient(config, platformGitHubTransport(now));
}

function handlersFor(database: DatabaseHandle | null, env: Bindings, now: () => Date) {
  if (database === null) return notWiredHandlers;
  const client = clientOf(env, now);
  const kernel = platformKernel(database);
  return new Map<'github', IngestHandler>([
    ['github', githubIngestHandler({ db: database.db, kernel, client, now })],
  ]);
}

export async function consumeIngestBatch(
  batch: MessageBatch<unknown>,
  env: Bindings,
): Promise<void> {
  const database = hyperdriveDatabase(env);
  const now = () => new Date();
  try {
    await consumeBatch(batch.messages, {
      handlers: handlersFor(database, env, now),
      deadLetter: env.INGEST_DLQ ?? null,
      watermarks: database ? postgresWatermarks(database.db) : null,
      sink: (line) => console.log(line),
      commit: commitOf(env),
      newId: () => crypto.randomUUID(),
      now,
    });
  } finally {
    await database?.release();
  }
}
