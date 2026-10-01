CREATE TABLE "grant_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"grant_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"trace_id" uuid,
	CONSTRAINT "grant_audit_action_known" CHECK ("grant_audit"."action" IN ('grant', 'revoke', 'bootstrap')),
	CONSTRAINT "grant_audit_actor_is_identity" CHECK ("grant_audit"."actor" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[A-Za-z0-9][A-Za-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[A-Za-z0-9][A-Za-z0-9_-]* as [A-Za-z0-9][A-Za-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$')
);
--> statement-breakpoint
CREATE TABLE "page_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"type" text NOT NULL,
	"jd_area" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"parent_id" uuid,
	"frontmatter" jsonb NOT NULL,
	"body_md" text NOT NULL,
	"status" text NOT NULL,
	"edit_source" text NOT NULL,
	"trace_id" uuid,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_versions_edit_source_is_identity" CHECK ("page_versions"."edit_source" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[A-Za-z0-9][A-Za-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[A-Za-z0-9][A-Za-z0-9_-]* as [A-Za-z0-9][A-Za-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$')
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"jd_area" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"parent_id" uuid,
	"frontmatter" jsonb NOT NULL,
	"body_md" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pages_type_known" CHECK ("pages"."type" IN ('skill', 'learning', 'persona', 'product', 'system_goal', 'product_strategy', 'data_sources')),
	CONSTRAINT "pages_status_known" CHECK ("pages"."status" IN ('draft', 'suggested', 'active', 'retired')),
	CONSTRAINT "pages_area_form" CHECK ("pages"."jd_area" ~ '^([0-9])0-\1[9]$'),
	CONSTRAINT "pages_slug_form" CHECK ("pages"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "pages_version_positive" CHECK ("pages"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_email_unique" UNIQUE("email"),
	CONSTRAINT "people_status_known" CHECK ("people"."status" IN ('active', 'pending')),
	CONSTRAINT "people_email_lowercase" CHECK ("people"."email" = lower("people"."email"))
);
--> statement-breakpoint
CREATE TABLE "queue_watermarks" (
	"queue" text PRIMARY KEY NOT NULL,
	"last_enqueued_at" timestamp with time zone NOT NULL,
	"last_consumed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_area" text,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "role_grants_role_known" CHECK ("role_grants"."role" IN ('admin', 'editor', 'viewer')),
	CONSTRAINT "role_grants_scope_known" CHECK ("role_grants"."scope_kind" IN ('org', 'jd_area')),
	CONSTRAINT "role_grants_area_matches_scope" CHECK (("role_grants"."scope_kind" = 'org' AND "role_grants"."scope_area" IS NULL) OR ("role_grants"."scope_kind" = 'jd_area' AND "role_grants"."scope_area" IS NOT NULL AND "role_grants"."scope_area" ~ '^([0-9])0-\1[9]$'))
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"source" text NOT NULL,
	"delivery_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_pk" PRIMARY KEY("source","delivery_id"),
	CONSTRAINT "webhook_deliveries_source_known" CHECK ("webhook_deliveries"."source" IN ('github'))
);
--> statement-breakpoint
ALTER TABLE "grant_audit" ADD CONSTRAINT "grant_audit_grant_id_role_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."role_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_granted_by_people_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grant_audit_grant" ON "grant_audit" USING btree ("grant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "page_versions_page_version" ON "page_versions" USING btree ("page_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_slug_per_area" ON "pages" USING btree ("jd_area","slug");--> statement-breakpoint
CREATE INDEX "pages_parent" ON "pages" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_grants_one_live" ON "role_grants" USING btree ("person_id","role","scope_kind",coalesce("scope_area", '')) WHERE "role_grants"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "role_grants_person" ON "role_grants" USING btree ("person_id");