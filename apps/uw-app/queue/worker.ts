import { commitOf, type Bindings } from '../env.ts';
import { hyperdriveDatabase } from '../database.ts';
import { consumeBatch, ingestHandlers } from './consumer.ts';
import { postgresWatermarks } from './watermarks.ts';

export async function consumeIngestBatch(
  batch: MessageBatch<unknown>,
  env: Bindings,
): Promise<void> {
  const database = hyperdriveDatabase(env);
  try {
    await consumeBatch(batch.messages, {
      handlers: ingestHandlers,
      deadLetter: env.INGEST_DLQ ?? null,
      watermarks: database ? postgresWatermarks(database.db) : null,
      sink: (line) => console.log(line),
      commit: commitOf(env),
      newId: () => crypto.randomUUID(),
      now: () => new Date(),
    });
  } finally {
    await database?.release();
  }
}
