CREATE TABLE "page_suggestion_sets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"page_id" uuid NOT NULL,
	"base_version" integer NOT NULL,
	"title" text NOT NULL,
	"frontmatter" jsonb NOT NULL,
	"body_md" text NOT NULL,
	"proposed_by" text NOT NULL,
	"proposed_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"accepted_version" integer,
	CONSTRAINT "page_suggestion_sets_status_known" CHECK ("page_suggestion_sets"."status" IN ('pending', 'accepted', 'rejected')),
	CONSTRAINT "page_suggestion_sets_base_positive" CHECK ("page_suggestion_sets"."base_version" >= 1),
	CONSTRAINT "page_suggestion_sets_proposed_by_identity" CHECK ("page_suggestion_sets"."proposed_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$'),
	CONSTRAINT "page_suggestion_sets_decided_by_human" CHECK ("page_suggestion_sets"."decided_by" IS NULL OR "page_suggestion_sets"."decided_by" ~ '^human:[A-Za-z0-9][A-Za-z0-9_-]*$'),
	CONSTRAINT "page_suggestion_sets_decided_together" CHECK (("page_suggestion_sets"."status" = 'pending') = ("page_suggestion_sets"."decided_by" IS NULL) AND ("page_suggestion_sets"."decided_by" IS NULL) = ("page_suggestion_sets"."decided_at" IS NULL)),
	CONSTRAINT "page_suggestion_sets_accepted_has_version" CHECK (("page_suggestion_sets"."status" = 'accepted') = ("page_suggestion_sets"."accepted_version" IS NOT NULL) AND ("page_suggestion_sets"."accepted_version" IS NULL OR "page_suggestion_sets"."accepted_version" > "page_suggestion_sets"."base_version"))
);
--> statement-breakpoint
ALTER TABLE "page_versions" DROP CONSTRAINT "page_versions_type_known";--> statement-breakpoint
ALTER TABLE "pages" DROP CONSTRAINT "pages_type_known";--> statement-breakpoint
ALTER TABLE "page_suggestion_sets" ADD CONSTRAINT "page_suggestion_sets_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "page_suggestion_sets_one_pending_per_proposer" ON "page_suggestion_sets" USING btree ("page_id","proposed_by") WHERE "page_suggestion_sets"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "page_suggestion_sets_page" ON "page_suggestion_sets" USING btree ("page_id","status","proposed_at");--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_type_known" CHECK ("page_versions"."type" IN ('skill', 'learning', 'persona', 'product', 'system_goal', 'product_strategy', 'data_sources', 'issue', 'platform', 'decision', 'knowledge', 'entry', 'profile', 'policy', 'portfolio', 'program', 'project', 'okr', 'charter'));--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_type_known" CHECK ("pages"."type" IN ('skill', 'learning', 'persona', 'product', 'system_goal', 'product_strategy', 'data_sources', 'issue', 'platform', 'decision', 'knowledge', 'entry', 'profile', 'policy', 'portfolio', 'program', 'project', 'okr', 'charter'));