INSERT INTO people (id, email, display_name, status) VALUES
  ('00000000-0000-4000-8000-000000000001', 'ian.lindsley@unfoldingword.org', 'Ian Lindsley', 'active')
ON CONFLICT (email) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_grants (id, person_id, role, scope_kind, scope_area, granted_by) VALUES
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'admin', 'org', NULL, NULL)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO grant_audit (actor, action, grant_id, before, after)
SELECT 'agent:bootstrap', 'bootstrap', g.id, NULL, to_jsonb(g)
FROM role_grants g
WHERE g.id = '00000000-0000-4000-8000-000000000101';
