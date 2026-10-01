import { describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { declarationOf } from './declarations.ts';
import * as schema from './schema.ts';
import { testServer, withMigratedDatabase } from './test-database.ts';

const timeout = 60_000;
type Sql = ReturnType<typeof postgres>;
type Check = (sql: Sql) => Promise<void>;

const decades = Array.from({ length: 10 }, (_, index) => `${index}0-${index}9`);
const p1 = '10000000-0000-4000-8000-000000000001';
const pageA = '20000000-0000-4000-8000-00000000000a';

function withFoundation(check: Check): Promise<void> {
  return withMigratedDatabase(testServer ?? '', async (connectionString) => {
    const sql = postgres(connectionString, { max: 1, onnotice: () => undefined });
    try {
      await check(sql);
    } finally {
      await sql.end();
    }
  });
}

async function attempt(sql: Sql, text: string): Promise<string> {
  return sql.unsafe(text).then(
    () => 'ok',
    (error: { code?: string }) => error.code ?? 'error',
  );
}

const person = (id: string, email: string) =>
  `INSERT INTO people (id, email, display_name, status) VALUES ('${id}', '${email}', 'P', 'active')`;
const grant = (personId: string, role: string, kind: string, area: string | null) =>
  `INSERT INTO role_grants (person_id, role, scope_kind, scope_area) VALUES ('${personId}', '${role}', '${kind}', ${area === null ? 'NULL' : `'${area}'`})`;
const page = (
  id: string,
  fields: Partial<Record<'type' | 'jd_area' | 'slug' | 'version', string>> = {},
) =>
  `INSERT INTO pages (id, type, jd_area, slug, title, frontmatter, body_md, version, status) VALUES ('${id}', '${fields.type ?? 'skill'}', '${fields.jd_area ?? '80-89'}', '${fields.slug ?? `s-${id.slice(-4)}`}', 'T', '{}', '', ${fields.version ?? '1'}, 'draft')`;
const snapshot = (version: number, source: string) =>
  `INSERT INTO page_versions (page_id, version, type, jd_area, slug, title, frontmatter, body_md, status, edit_source) VALUES ('${pageA}', ${version}, 'skill', '80-89', 'shared', 'T', '{}', '', 'draft', '${source}')`;
const delivery = (source: string) =>
  `INSERT INTO webhook_deliveries (source, delivery_id) VALUES ('${source}', 'd-1')`;

const peopleRefusals: Check = async (sql) => {
  expect(
    await attempt(sql, person('10000000-0000-4000-8000-0000000000aa', 'Mixed@unfoldingword.org')),
  ).toBe('23514');
  expect(
    await attempt(
      sql,
      `INSERT INTO people (email, display_name, status) VALUES ('x@unfoldingword.org', 'X', 'suspended')`,
    ),
  ).toBe('23514');
  expect(await attempt(sql, person(p1, 'p1@unfoldingword.org'))).toBe('ok');
  expect(
    await attempt(sql, person('10000000-0000-4000-8000-0000000000ab', 'p1@unfoldingword.org')),
  ).toBe('23505');
};

const grantRefusals: Check = async (sql) => {
  await sql.unsafe(person(p1, 'p1@unfoldingword.org'));
  expect(await attempt(sql, grant(p1, 'owner', 'org', null))).toBe('23514');
  expect(await attempt(sql, grant(p1, 'admin', 'org', '80-89'))).toBe('23514');
  expect(await attempt(sql, grant(p1, 'editor', 'jd_area', null))).toBe('23514');
  expect(await attempt(sql, grant(p1, 'editor', 'jd_area', '80-19'))).toBe('23514');
  expect(await attempt(sql, grant(p1, 'editor', 'jd_area', '80-89'))).toBe('ok');
};

const grantAreas: Check = async (sql) => {
  await sql.unsafe(person(p1, 'p1@unfoldingword.org'));
  for (const area of decades) {
    expect(await attempt(sql, grant(p1, 'viewer', 'jd_area', area))).toBe('ok');
  }
  expect(await attempt(sql, grant(p1, 'viewer', 'jd_area', '80-79'))).toBe('23514');
};

const oneLiveGrant: Check = async (sql) => {
  await sql.unsafe(person(p1, 'p1@unfoldingword.org'));
  expect(await attempt(sql, grant(p1, 'editor', 'jd_area', '80-89'))).toBe('ok');
  expect(await attempt(sql, grant(p1, 'editor', 'jd_area', '80-89'))).toBe('23505');
  await sql.unsafe(`UPDATE role_grants SET revoked_at = now() WHERE person_id = '${p1}'`);
  expect(await attempt(sql, grant(p1, 'editor', 'jd_area', '80-89'))).toBe('ok');
};

const bootstrapAdmins: Check = async (sql) => {
  const admins = await sql`
    SELECT p.email FROM role_grants g JOIN people p ON p.id = g.person_id
    WHERE g.role = 'admin' AND g.scope_kind = 'org' AND g.revoked_at IS NULL ORDER BY p.email`;
  expect(admins.map((row) => row['email'])).toEqual(['ian.lindsley@unfoldingword.org']);
  const audits = await sql`SELECT actor, action FROM grant_audit WHERE action = 'bootstrap'`;
  expect(audits).toHaveLength(1);
  expect(audits.every((row) => row['actor'] === 'agent:bootstrap')).toBe(true);
};

const auditIsAppendOnly: Check = async (sql) => {
  expect(await attempt(sql, `UPDATE grant_audit SET actor = 'human:x'`)).toBe('P0001');
  expect(await attempt(sql, `DELETE FROM grant_audit`)).toBe('P0001');
  expect(await attempt(sql, `TRUNCATE grant_audit`)).toBe('P0001');
};

const auditActorIsIdentity: Check = async (sql) => {
  const audit = (actor: string) =>
    `INSERT INTO grant_audit (actor, action, grant_id) VALUES ('${actor}', 'grant', '00000000-0000-4000-8000-000000000101')`;
  expect(await attempt(sql, audit('robot:x'))).toBe('23514');
  expect(await attempt(sql, audit('human:ian'))).toBe('ok');
};

const pageRefusals: Check = async (sql) => {
  expect(await attempt(sql, page('20000000-0000-4000-8000-000000000001', { type: 'policy' }))).toBe(
    '23514',
  );
  expect(
    await attempt(sql, page('20000000-0000-4000-8000-000000000002', { slug: 'Not Kebab' })),
  ).toBe('23514');
  expect(await attempt(sql, page('20000000-0000-4000-8000-000000000003', { jd_area: '8-9' }))).toBe(
    '23514',
  );
  expect(await attempt(sql, page('20000000-0000-4000-8000-000000000004', { version: '0' }))).toBe(
    '23514',
  );
};

const pageAreas: Check = async (sql) => {
  for (const [index, area] of decades.entries()) {
    expect(
      await attempt(sql, page(`20000000-0000-4000-8000-0000000001${index}0`, { jd_area: area })),
    ).toBe('ok');
  }
  expect(
    await attempt(sql, page('20000000-0000-4000-8000-0000000002ff', { jd_area: '80-19' })),
  ).toBe('23514');
};

const slugsPerArea: Check = async (sql) => {
  expect(await attempt(sql, page(pageA, { slug: 'shared' }))).toBe('ok');
  expect(await attempt(sql, page('20000000-0000-4000-8000-00000000000b', { slug: 'shared' }))).toBe(
    '23505',
  );
  expect(
    await attempt(
      sql,
      page('20000000-0000-4000-8000-00000000000c', { slug: 'shared', jd_area: '20-29' }),
    ),
  ).toBe('ok');
};

const snapshotsPerVersion: Check = async (sql) => {
  await sql.unsafe(page(pageA, { slug: 'shared' }));
  expect(await attempt(sql, snapshot(1, 'human:ian'))).toBe('ok');
  expect(await attempt(sql, snapshot(1, 'human:ian'))).toBe('23505');
  expect(await attempt(sql, snapshot(2, 'robot:x'))).toBe('23514');
};

const deliveriesOncePerSource: Check = async (sql) => {
  expect(await attempt(sql, delivery('github'))).toBe('ok');
  expect(await attempt(sql, delivery('github'))).toBe('23505');
  expect(await attempt(sql, delivery('stripe'))).toBe('23514');
};

const run = (check: Check) => () => withFoundation(check);

describe.skipIf(!testServer)('FD-7 people on real Postgres', () => {
  it(
    'refuses an email that is not lowercase, and an unknown status',
    { timeout },
    run(peopleRefusals),
  );
});

describe.skipIf(!testServer)('FD-8 role_grants on real Postgres', () => {
  it(
    'refuses an unknown role, an org grant with an area, and an area grant without a valid one',
    { timeout },
    run(grantRefusals),
  );
  it(
    'accepts every decade from 00-09 to 90-99 and refuses a mismatched one',
    { timeout },
    run(grantAreas),
  );
  it(
    'holds one live grant per person, role and scope, and allows it again after revoke',
    { timeout },
    run(oneLiveGrant),
  );
});

describe.skipIf(!testServer)(
  'FD-8 grant_audit and the bootstrap migration on real Postgres',
  () => {
    it(
      'grants org admin to Ian only in the bootstrap migration, with one audit row',
      { timeout },
      run(bootstrapAdmins),
    );
    it('refuses UPDATE, DELETE and TRUNCATE on grant_audit', { timeout }, run(auditIsAppendOnly));
    it('refuses an actor that is not an identity string', { timeout }, run(auditActorIsIdentity));
  },
);

describe.skipIf(!testServer)('FD-9 pages and page_versions on real Postgres', () => {
  it(
    'refuses an unknown type, a bad slug, a bad area and version 0',
    { timeout },
    run(pageRefusals),
  );
  it(
    'accepts every decade from 00-09 to 90-99 and refuses a mismatched one',
    { timeout },
    run(pageAreas),
  );
  it(
    'keeps slugs unique per area and allows the same slug in another area',
    { timeout },
    run(slugsPerArea),
  );
  it(
    'keeps one snapshot per page version and an identity-shaped edit source',
    { timeout },
    run(snapshotsPerVersion),
  );
});

describe.skipIf(!testServer)('FD-10 webhook_deliveries on real Postgres', () => {
  it(
    'records a delivery id once per source and refuses an unknown source',
    { timeout },
    run(deliveriesOncePerSource),
  );
});

describe('FD-7 FD-8 FD-9 FD-10 FD-11 table declarations (plan 2.6)', () => {
  it('declares every table with its classification and offline eligibility', () => {
    expect(declarationOf(schema.people)).toEqual({
      classification: 'internal',
      offlineEligibility: 'cache_readonly',
    });
    expect(declarationOf(schema.roleGrants)).toEqual({
      classification: 'restricted',
      offlineEligibility: 'never',
    });
    expect(declarationOf(schema.grantAudit)).toEqual({
      classification: 'restricted',
      offlineEligibility: 'never',
    });
    expect(declarationOf(schema.pages)).toEqual({
      classification: 'internal',
      offlineEligibility: 'sync',
    });
    expect(declarationOf(schema.pageVersions)).toEqual({
      classification: 'internal',
      offlineEligibility: 'sync',
    });
    expect(declarationOf(schema.webhookDeliveries)).toEqual({
      classification: 'internal',
      offlineEligibility: 'never',
    });
    expect(declarationOf(schema.queueWatermarks)).toEqual({
      classification: 'internal',
      offlineEligibility: 'never',
    });
  });
});
