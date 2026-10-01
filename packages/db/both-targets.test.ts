import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate, createEmbeddedDatabase } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { migrationTimestamps } from './journal.ts';
import { appliedMigrations } from './migration-ledger.ts';
import { grantAudit, people, roleGrants } from './schema.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

const bootstrapPerson = '00000000-0000-4000-8000-000000000001';

afterAll(closeEmbeddedTemplate);

async function refusal(
  work: PromiseLike<unknown>,
): Promise<{ code: string | null; constraint: string | null }> {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

function badArea(opened: OpenedDatabase) {
  return opened.db.insert(roleGrants).values({
    personId: bootstrapPerson,
    role: 'admin',
    scopeKind: 'jd_area',
    scopeArea: '80-99',
  });
}

function describeTarget(target: DatabaseTarget): void {
  let opened: OpenedDatabase;
  beforeAll(async () => {
    opened = await target.open();
  }, 60_000);
  afterAll(() => opened.close());

  it('applied every migration in the journal, in order', async () => {
    expect(await appliedMigrations(opened.db)).toEqual(migrationTimestamps);
  });

  it('refuses an UPDATE of grant_audit through its append-only trigger', async () => {
    const refused = await refusal(opened.db.update(grantAudit).set({ actor: 'human:x' }));
    expect(refused.code).toBe('P0001');
  });

  it('refuses a grant whose area is not NN-NN, naming the constraint', async () => {
    expect(await refusal(badArea(opened))).toEqual({
      code: '23514',
      constraint: 'role_grants_area_matches_scope',
    });
  });
}

describe.each(databaseTargets)(
  'DX-6 DX-2 the real migrations and constraints on the $name database',
  describeTarget,
);

describe('DX-2 each embedded database is its own', () => {
  it('does not show one clone a row written in another', async () => {
    const first = await createEmbeddedDatabase();
    const second = await createEmbeddedDatabase();
    try {
      await first.db.insert(people).values({
        email: 'clone@fixture.unfoldingword.org',
        displayName: 'Clone',
        status: 'active',
      });
      expect(await second.db.select().from(people)).toHaveLength(1);
      expect(await first.db.select().from(people)).toHaveLength(2);
    } finally {
      await first.close();
      await second.close();
    }
  }, 60_000);
});

describe.skipIf(process.env['CI'] !== 'true')('DX-6 both databases run in CI', () => {
  it('includes the server target', () => {
    expect(databaseTargets.map((target) => target.name)).toEqual(['embedded', 'server']);
  });
});
