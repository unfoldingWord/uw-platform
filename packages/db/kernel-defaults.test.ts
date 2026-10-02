import { getTableColumns } from 'drizzle-orm';
import { pgTable, timestamp, uuid, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './schema.ts';

const kernelTables: readonly PgTable[] = [
  schema.harnesses,
  schema.harnessStages,
  schema.harnessItems,
  schema.harnessEvents,
  schema.harnessRuns,
  schema.gateDecisions,
  schema.delegations,
  schema.measurements,
  schema.personas,
];

const stampedTypes = new Set([
  'PgUUID',
  'PgTimestamp',
  'PgTimestampString',
  'PgDate',
  'PgDateString',
]);

function defaulted(table: PgTable): string[] {
  return Object.entries(getTableColumns(table))
    .filter(([, column]) => stampedTypes.has(column.columnType) && column.hasDefault)
    .map(([name]) => name);
}

describe('KN-1 kernel tables take every instant and id from the command, so the sim is deterministic', () => {
  it.each(kernelTables.map((table) => [table] as const))(
    '%s has no default on an id or instant',
    (table) => {
      expect(defaulted(table)).toEqual([]);
    },
  );

  it('flags a default it is shown', () => {
    expect(defaulted(schema.people)).toContain('id');
    expect(defaulted(schema.people)).toContain('createdAt');
  });

  it('flags a timestamp default on a planted table', () => {
    const planted = pgTable('planted', {
      id: uuid('id').primaryKey(),
      seenAt: timestamp('seen_at').notNull().defaultNow(),
    });
    expect(defaulted(planted)).toEqual(['seenAt']);
  });
});
