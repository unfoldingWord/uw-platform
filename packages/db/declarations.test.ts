import { describe, expect, expectTypeOf, it } from 'vitest';
import { uuid } from 'drizzle-orm/pg-core';
import {
  classifications,
  declarationOf,
  declareTable,
  offlineEligibilities,
  undeclaredTables,
  type Classification,
  type OfflineEligibility,
} from './declarations.ts';
import * as schema from './schema.ts';
import * as ordered from './fixtures/ordered/schema.ts';
import * as undeclared from './fixtures/undeclared/schema.ts';

describe('table declarations (plan §2.6)', () => {
  it('finds no table in schema.ts without a classification and an offline eligibility', () => {
    expect(undeclaredTables(schema)).toEqual([]);
  });

  it('reports an exported pgTable that bypasses declareTable', () => {
    expect(undeclaredTables(undeclared)).toEqual(['bare']);
  });

  it('keeps the declaration readable as data for the sync manifest', () => {
    expect(declarationOf(ordered.probes)).toEqual({
      classification: 'internal',
      offlineEligibility: 'never',
    });
  });

  it('holds the closed sets of plan §2.6 as types', () => {
    expectTypeOf<Classification>().toEqualTypeOf<
      'public' | 'internal' | 'restricted' | 'sensitive'
    >();
    expectTypeOf<OfflineEligibility>().toEqualTypeOf<'sync' | 'cache_readonly' | 'never'>();
    expect(classifications).toEqual(['public', 'internal', 'restricted', 'sensitive']);
    expect(offlineEligibilities).toEqual(['sync', 'cache_readonly', 'never']);
  });

  it('refuses a value outside the closed sets when the types are bypassed', () => {
    const unknownValue: string = 'secret';
    const columns = { id: uuid('id').primaryKey() };
    expect(() =>
      declareTable('leaky', columns, {
        classification: unknownValue as Classification,
        offlineEligibility: 'never',
      }),
    ).toThrow('leaky: classification must be one of public, internal, restricted, sensitive');
    expect(() =>
      declareTable('leaky', columns, {
        classification: 'internal',
        offlineEligibility: unknownValue as OfflineEligibility,
      }),
    ).toThrow('leaky: offlineEligibility must be one of sync, cache_readonly, never');
  });
});
