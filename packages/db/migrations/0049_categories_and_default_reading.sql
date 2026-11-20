CREATE TABLE "jd_categories" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jd_categories_code_form" CHECK ("jd_categories"."code" ~ '^[0-9]{2}$'),
	CONSTRAINT "jd_categories_name_not_blank" CHECK (length(btrim("jd_categories"."name")) BETWEEN 1 AND 80)
);
--> statement-breakpoint
ALTER TABLE "grant_audit" DROP CONSTRAINT "grant_audit_action_known";--> statement-breakpoint
ALTER TABLE "grant_audit" ADD CONSTRAINT "grant_audit_action_known" CHECK ("grant_audit"."action" IN ('grant', 'revoke', 'bootstrap', 'default'));--> statement-breakpoint
WITH needing AS (
	SELECT p."id" FROM "people" p
	WHERE p."status" = 'active' AND NOT EXISTS (
		SELECT 1 FROM "role_grants" g
		WHERE g."person_id" = p."id" AND g."revoked_at" IS NULL
			AND (g."scope_kind" = 'org' OR g."scope_area" = '00-09')
	)
), made AS (
	INSERT INTO "role_grants" ("person_id", "role", "scope_kind", "scope_area")
	SELECT "id", 'viewer', 'jd_area', '00-09' FROM needing
	RETURNING "id", "person_id", "granted_at"
)
INSERT INTO "grant_audit" ("actor", "action", "grant_id", "before", "after")
SELECT 'human:' || made."person_id"::text, 'default', made."id", NULL, jsonb_build_object(
	'id', made."id", 'person_id', made."person_id", 'role', 'viewer', 'scope_kind', 'jd_area',
	'scope_area', '00-09', 'granted_by', NULL, 'granted_at', made."granted_at",
	'expires_at', NULL, 'revoked_at', NULL
) FROM made;
