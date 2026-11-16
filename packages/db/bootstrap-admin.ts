export type FirstAdmin = { readonly email: string; readonly displayName: string };

export type RunSql = (text: string, params: readonly string[]) => Promise<unknown>;

const bootstrapPersonId = '00000000-0000-4000-8000-000000000001';
const bootstrapGrantId = '00000000-0000-4000-8000-000000000101';

const addPerson = `INSERT INTO people (id, email, display_name, status)
VALUES ($1, $2, $3, 'active')
ON CONFLICT DO NOTHING`;

const addGrant = `INSERT INTO role_grants (id, person_id, role, scope_kind, scope_area, granted_by)
SELECT $1, p.id, 'admin', 'org', NULL, NULL FROM people p
WHERE p.email = $2
  AND NOT EXISTS (
    SELECT 1 FROM role_grants g
    WHERE g.role = 'admin' AND g.scope_kind = 'org' AND g.revoked_at IS NULL
  )
ON CONFLICT DO NOTHING`;

const addAudit = `INSERT INTO grant_audit (actor, action, grant_id, before, after)
SELECT 'agent:bootstrap', 'bootstrap', g.id, NULL, to_jsonb(g) FROM role_grants g
WHERE g.id = $1
  AND NOT EXISTS (SELECT 1 FROM grant_audit a WHERE a.grant_id = $1 AND a.action = 'bootstrap')`;

export async function bootstrapAdmin(run: RunSql, admin: FirstAdmin): Promise<void> {
  await run(addPerson, [bootstrapPersonId, admin.email, admin.displayName]);
  await run(addGrant, [bootstrapGrantId, admin.email]);
  await run(addAudit, [bootstrapGrantId]);
}
