import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnyExecutor } from '../any-database.ts';
import { closeEmbeddedTemplate } from '../embedded.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from '../test-targets.ts';
import { latestNamedQuery } from './events.ts';
import { liveRuns, runsQuery } from './runs.ts';

afterAll(closeEmbeddedTemplate);

const harness = '00000000-0000-4000-8000-0000000000b1';
const item = '00000000-0000-4000-8000-0000000000d1';

const breakers = (harnessId: string | null) => (tx: AnyExecutor) =>
  latestNamedQuery(tx, ['breaker_holding', 'breaker_open'], harnessId);

function rowsOf(result: unknown): readonly unknown[] {
  if (Array.isArray(result)) return result;
  if (typeof result === 'object' && result !== null && Object.hasOwn(result, 'rows')) {
    const rows: unknown = Reflect.get(result, 'rows');
    return Array.isArray(rows) ? rows : [];
  }
  return [];
}

type Planned = { getSQL(): SQL };

async function planOf(db: AnyExecutor, query: (tx: AnyExecutor) => Planned): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    const result: unknown = await tx.execute(sql`EXPLAIN ${query(tx).getSQL()}`);
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
    expect(await planOf(db(), breakers(null))).toContain('harness_events_breaker_latest');
  });

  it('reads the newest breaker event of one harness through the breaker index', async () => {
    expect(await planOf(db(), breakers(harness))).toContain('harness_events_breaker_latest');
  });

  it('reads the live runs of one harness through the live-run index', async () => {
    const plan = await planOf(db(), (tx) => runsQuery(tx, liveRuns({ harnessId: harness })));
    expect(plan).toContain('harness_runs_live');
  });

  it('reads the live run of one item through an index on the item', async () => {
    const plan = await planOf(db(), (tx) => runsQuery(tx, liveRuns({ itemId: item })));
    expect(plan).toMatch(/Index Scan using harness_runs_(one_live_per_item|item)\b/);
  });
}

describe('the breaker and live-run reads do not scan their tables', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => describeTarget(target),
  );
});
