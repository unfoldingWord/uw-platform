import type { Executor } from '@uw/db/client';
import type { FileStore } from '../pages/file-store.ts';
import { expireRawOutput } from './observation-records.ts';

const KEPT_MONTHS = 13;
const EXPIRY_LIMIT = 500;

function rawCutoff(at: Date): Date {
  const cutoff = new Date(at.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - KEPT_MONTHS);
  return cutoff;
}

export function expireMeasureRaw(db: Executor, files: FileStore, at: Date): Promise<number> {
  return expireRawOutput(db, files, rawCutoff(at), EXPIRY_LIMIT);
}
