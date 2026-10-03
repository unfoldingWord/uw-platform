import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnyExecutor } from '../any-database.ts';
import { closeEmbeddedTemplate } from '../embedded.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from '../test-targets.ts';
import { latestNamedQuery } from './events.ts';

afterAll(closeEmbeddedTemplate);

const harness = '00000000-0000-4000-8000-0000000000b1';

function rowsOf(result: unknown): readonly unknown[] {
  if (Array.isArray(result)) return result;
  if (typeof result === 'object' && result !== null && Object.hasOwn(result, 'rows')) {
    const rows: unknown = Reflect.get(result, 'rows');
    return Array.isArray(rows) ? rows : [];
  }
  return [];
}

async function planOf(db: AnyExecutor, harnessId: string | null): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    const query = latestNamedQuery(tx, ['breaker_holding', 'breaker_open'], harnessId);
    const result: unknown = await tx.execute(sql`EXPLAIN ${query.getSQL()}`);
    return rowsOf(result)
      .map((row) => JSON.stringify(row))
      .join('\n');
  });
}

function describeTarget(target: DatabaseTarget): void {
  let opened: OpenedDatabase | undefined;
  const db = (): AnyExecutor => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
  beforeAll(async () => {
    opened = await target.open();
  }, 60_000);
  afterAll(() => opened?.close());

  it('reads the newest breaker event across every harness through the breaker index', async () => {
    expect(await planOf(db(), null)).toContain('harness_events_breaker_latest');
  });

  it('reads the newest breaker event of one harness through the breaker index', async () => {
    expect(await planOf(db(), harness)).toContain('harness_events_breaker_latest');
  });
}

describe('latestNamed does not scan the whole event log', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => describeTarget(target),
  );
});
