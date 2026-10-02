import { sql } from 'drizzle-orm';
import type { AnyDatabase } from './any-database.ts';

export type EventExecutor = Pick<AnyDatabase, 'execute'>;

export const harnessA = '00000000-0000-4000-8000-0000000000b1';
export const harnessB = '00000000-0000-4000-8000-0000000000b2';

const at = '2026-10-01T09:00:00.000Z';
const traceId = '00000000-0000-4000-8000-0000000000e1';

export function eventId(harnessId: string, n: number): string {
  return `00000000-0000-4000-9000-${harnessId.slice(-4)}${n.toString(16).padStart(8, '0')}`;
}

export function seedHarness(db: EventExecutor, id: string, key: string, area: string) {
  return db.execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at)
    VALUES (${id}, ${key}, 'software', ${area}, ${at}::timestamptz)`);
}

export function insertEvent(
  db: EventExecutor,
  harnessId: string,
  n: number,
  name = 'item_created',
) {
  return db.execute(sql`INSERT INTO harness_events (id, harness_id, item_id, name, actor, evidence, trace_id, at)
    VALUES (${eventId(harnessId, n)}, ${harnessId}, NULL, ${name}, 'human:00000000-0000-4000-8000-000000000001',
      '{}'::jsonb, ${traceId}, ${at}::timestamptz)`);
}
