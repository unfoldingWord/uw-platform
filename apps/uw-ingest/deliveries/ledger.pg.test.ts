import { getTableName, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createClient, type Database } from '@uw/db/client';
import { webhookDeliveries } from '@uw/db/schema';
import { testServer, withMigratedDatabase } from '@uw/db/test-database';
import fixture from '../fixtures/github/pull_request.opened.json' with { type: 'json' };
import { harness, post } from '../testing/deliver.ts';
import { owns, postgresLedger } from './ledger.ts';

async function withLedgerDatabase<T>(work: (db: Database) => Promise<T>): Promise<T> {
  return withMigratedDatabase(testServer ?? '', async (target) => {
    const db = createClient(target);
    try {
      return await work(db);
    } finally {
      await db.$client.end();
    }
  });
}

async function ledgerColumns(db: Database): Promise<string[]> {
  const rows = await db.execute<{ column_name: string }>(
    sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'webhook_deliveries' ORDER BY column_name`,
  );
  return [...rows].map((row) => row.column_name);
}

describe.skipIf(!testServer)('FD-10 the delivery ledger on real Postgres', () => {
  it('claims a delivery once and lets a released one be claimed again', () =>
    withLedgerDatabase(async (db) => {
      const ledger = postgresLedger(db);
      expect(await ledger.claim('github', 'd-1')).toBe(true);
      expect(await ledger.claim('github', 'd-1')).toBe(false);
      await ledger.release('github', 'd-1');
      expect(await ledger.claim('github', 'd-1')).toBe(true);
    }));

  it('accepts a signed delivery, refuses its replay and stores only the delivery id', () =>
    withLedgerDatabase(async (db) => {
      const ledger = postgresLedger(db);
      const h = harness({ openLedger: () => ({ ledger, release: async () => undefined }) });
      const body = JSON.stringify(fixture);
      expect((await post(h, { body })).status).toBe(202);
      expect((await post(h, { body })).status).toBe(409);
      const counted = await db.execute<{ count: string }>(
        sql`SELECT count(*)::text AS count FROM webhook_deliveries`,
      );
      expect([...counted]).toEqual([{ count: '1' }]);
      expect(await ledgerColumns(db)).toEqual(['delivery_id', 'received_at', 'source']);
      expect(h.queue.sent).toHaveLength(1);
    }));

  it('owns exactly the webhook_deliveries table', () => {
    expect(owns).toEqual([getTableName(webhookDeliveries)]);
  });
});
