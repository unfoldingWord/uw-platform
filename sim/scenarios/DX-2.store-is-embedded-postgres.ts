import assert from 'node:assert/strict';
import { pgConstraint, pgErrorCode } from '@uw/db/errors';
import { migrationTimestamps } from '@uw/db/journal';
import { rewriteGrantAudit, seedGrant, type SeedGrant } from '@uw/db/test-seed';
import { defineScenario } from '../scenario.ts';

type Refusal = { readonly code: string | null; readonly constraint: string | null };

export function grantOutsideItsArea(grantedAt: Date): SeedGrant {
  return {
    id: 'd1000000-0000-4000-8000-000000000001',
    personId: '00000000-0000-4000-8000-000000000001',
    role: 'admin',
    scopeKind: 'jd_area',
    scopeArea: '80-99',
    grantedAt,
    expiresAt: null,
  };
}

async function refusalOf(label: string, work: () => PromiseLike<unknown>): Promise<Refusal> {
  try {
    await work();
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error(`the embedded Postgres accepted ${label}, which it must refuse`);
}

export const scenario = defineScenario({
  id: 'DX-2',
  title:
    'the Store is the Drizzle adapter over an embedded Postgres running the real migrations and constraints',
  run: async (world) => {
    const applied = await world.adapters.store.appliedMigrations();
    assert.deepEqual(applied, migrationTimestamps);
    const area = await refusalOf('a grant whose area does not match its scope', () =>
      seedGrant(world.database.db, grantOutsideItsArea(world.adapters.clock.now())),
    );
    assert.deepEqual(area, { code: '23514', constraint: 'role_grants_area_matches_scope' });
    const audit = await refusalOf('an update to the append-only grant_audit', () =>
      rewriteGrantAudit(world.database.db, 'human:sim'),
    );
    assert.equal(audit.code, 'P0001');
    return {
      events: [],
      state: {
        appliedMigrations: applied.length,
        refused: { role_grants_area_matches_scope: '23514', grant_audit_append_only: 'P0001' },
      },
    };
  },
});
