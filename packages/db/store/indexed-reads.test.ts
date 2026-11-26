import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnyExecutor } from '../any-database.ts';
import { closeEmbeddedTemplate } from '../embedded.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from '../test-targets.ts';
import { deliveredInThreadQuery } from './assistants.ts';
import {
  assistantLedgerQuery,
  assistantOpenTurnsQuery,
  assistantSpendQuery,
  latestNamedQuery,
  recentQuery,
} from './events.ts';
import { failedForQuery, liveRuns, recentRunsQuery, runsQuery, startedSinceQuery } from './runs.ts';

afterAll(closeEmbeddedTemplate);

const harness = '00000000-0000-4000-8000-0000000000b1';
const item = '00000000-0000-4000-8000-0000000000d1';

const since = new Date('2026-10-01T00:00:00.000Z');

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

  it('recent, startedSince and failedFor use their indexes', async () => {
    const recent = (tx: AnyExecutor) =>
      recentQuery(tx, { since, names: null, agentsOnly: true, limit: 100 });
    expect(await planOf(db(), recent)).toContain('harness_events_at');
    const started = (tx: AnyExecutor) => startedSinceQuery(tx, since, 100);
    expect(await planOf(db(), started)).toContain('harness_runs_started_at');
    const input = { personId: item, harnessIds: [harness], since, limit: 50 };
    const failed = (tx: AnyExecutor) => failedForQuery(tx, input);
    expect(await planOf(db(), failed)).toContain('harness_runs_failed_ended');
  });

  it('reads the recent runs of one harness through the harness and start index', async () => {
    const recentRuns = (tx: AnyExecutor) => recentRunsQuery(tx, harness, 50);
    expect(await planOf(db(), recentRuns)).toContain('harness_runs_harness_started');
  });

  describeAssistantReads(db);
}

function describeAssistantReads(db: () => AnyExecutor): void {
  const names = ['assistant_turn_started', 'assistant_turn_finished'] as const;

  it('reads one assistant request or effect lifecycle through its evidence index', async () => {
    const byRequest = (tx: AnyExecutor) =>
      assistantLedgerQuery(tx, {
        harnessId: harness,
        names,
        about: { requestId: item },
        limit: 100,
      });
    expect(await planOf(db(), byRequest)).toContain('harness_events_assistant_request');
    const doneNames = ['assistant_effect_done', 'assistant_effect_failed'] as const;
    const byEffect = (tx: AnyExecutor) =>
      assistantLedgerQuery(tx, {
        harnessId: harness,
        names: doneNames,
        about: { effectId: item },
        limit: 100,
      });
    expect(await planOf(db(), byEffect)).toContain('harness_events_assistant_effect');
  });

  it('sums an assistant month through the spend index and counts open turns without a table scan', async () => {
    const spend = (tx: AnyExecutor) => assistantSpendQuery(tx, { harnessId: harness, since });
    expect(await planOf(db(), spend)).toContain('harness_events_assistant_spend');
    const open = (tx: AnyExecutor) => assistantOpenTurnsQuery(tx, { harnessId: harness, since });
    const plan = await planOf(db(), open);
    expect(plan).not.toContain('Seq Scan');
    expect(plan).toMatch(/Index Scan using harness_events_assistant_\w+ on harness_events /);
    expect(plan).toMatch(
      /Index Scan using harness_events_assistant_\w+ on harness_events finished_turn/,
    );
  });

  it('reads delivered thread history through the thread and effect indexes', async () => {
    const thread = (tx: AnyExecutor) =>
      deliveredInThreadQuery(tx, {
        harnessId: harness,
        channel: 'zulip_dm',
        threadKey: 'dm',
        before: { recordedAt: since, id: item },
        since,
        limit: 6,
      });
    const plan = await planOf(db(), thread);
    expect(plan).toContain('assistant_requests_thread');
    expect(plan).toContain('harness_events_assistant_effect');
  });
}

describe('the breaker and live-run reads do not scan their tables', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => describeTarget(target),
  );
});
