import assert from 'node:assert/strict';
import { pgConstraint, pgErrorCode } from '@uw/db/errors';
import { migrationTimestamps } from '@uw/db/journal';
import { rewriteGrantAudit, seedGrant } from '@uw/db/test-seed';
import { defineScenario } from '../scenario.ts';

type Refusal = { readonly code: string | null; readonly constraint: string | null };

async function refusalOf(work: () => PromiseLike<unknown>): Promise<Refusal> {
  try {
    await work();
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('the embedded Postgres accepted a write its constraints refuse');
}

export const scenario = defineScenario({
  id: 'DX-2',
  title:
    'the Store is the Drizzle adapter over an embedded Postgres running the real migrations and constraints',
  run: async (world) => {
    const applied = await world.adapters.store.appliedMigrations();
    assert.deepEqual(applied, migrationTimestamps);
    const area = await refusalOf(() =>
      seedGrant(world.database.db, {
        id: 'd1000000-0000-4000-8000-000000000001',
        personId: '00000000-0000-4000-8000-000000000001',
        role: 'admin',
        scopeKind: 'jd_area',
        scopeArea: '80-99',
        grantedAt: world.adapters.clock.now(),
        expiresAt: null,
      }),
    );
    assert.deepEqual(area, { code: '23514', constraint: 'role_grants_area_matches_scope' });
    const audit = await refusalOf(() => rewriteGrantAudit(world.database.db, 'human:sim'));
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
