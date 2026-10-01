import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { unmigratedChanges } from './drift.ts';

const db = (relative: string) =>
  fileURLToPath(new URL(`../../packages/db/${relative}`, import.meta.url));
const migrations = db('migrations');
const timeout = 60_000;

describe('schema drift (drizzle-kit generate against the committed migrations)', () => {
  it('finds a migration for every change in packages/db/schema.ts', { timeout }, () => {
    expect(unmigratedChanges(db('schema.ts'), migrations)).toEqual([]);
  });

  it('finds a migration for every change in the ordered fixture', { timeout }, () => {
    expect(
      unmigratedChanges(db('fixtures/ordered/schema.ts'), db('fixtures/ordered/migrations')),
    ).toEqual([]);
  });

  it('reports a table added to a schema without a migration', { timeout }, () => {
    expect(
      unmigratedChanges(db('fixtures/drifted/schema.ts'), db('fixtures/drifted/migrations')),
    ).toHaveLength(1);
  });
});
