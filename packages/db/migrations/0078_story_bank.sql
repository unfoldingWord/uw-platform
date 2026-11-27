CREATE TABLE "story_consents" (
	"page_id" uuid PRIMARY KEY NOT NULL,
	"consent_reference" text NOT NULL,
	"consented_by" text NOT NULL,
	"consent_form" text NOT NULL,
	"consented_on" date NOT NULL,
	"consent_expires" date,
	"anonymised" boolean NOT NULL,
	"name_use" text NOT NULL,
	"location_precision" text NOT NULL,
	"photo_release" boolean NOT NULL,
	"photo_reference" text,
	"review_on" date,
	"withdrawn_at" timestamp with time zone,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "story_consents_form_known" CHECK ("story_consents"."consent_form" IN ('written', 'audio', 'video', 'witnessed_verbal')),
	CONSTRAINT "story_consents_name_use_known" CHECK ("story_consents"."name_use" IN ('real', 'pseudonym', 'none')),
	CONSTRAINT "story_consents_location_known" CHECK ("story_consents"."location_precision" IN ('country', 'region', 'none')),
	CONSTRAINT "story_consents_reference_given" CHECK (length(trim("story_consents"."consent_reference")) > 0),
	CONSTRAINT "story_consents_photo_reference_with_release" CHECK ("story_consents"."photo_reference" IS NULL OR "story_consents"."photo_release"),
	CONSTRAINT "story_consents_updated_by_identity" CHECK ("story_consents"."updated_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$')
);
--> statement-breakpoint
CREATE TABLE "story_levels" (
	"page_id" uuid PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "story_levels_level_known" CHECK ("story_levels"."level" IN ('internal', 'private_circulation', 'newsletter', 'public')),
	CONSTRAINT "story_levels_updated_by_identity" CHECK ("story_levels"."updated_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$')
);
--> statement-breakpoint
CREATE TABLE "story_media_levels" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"page_id" uuid NOT NULL,
	"level" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "story_media_levels_level_known" CHECK ("story_media_levels"."level" IN ('internal', 'private_circulation', 'newsletter', 'public')),
	CONSTRAINT "story_media_levels_updated_by_identity" CHECK ("story_media_levels"."updated_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$')
);
--> statement-breakpoint
CREATE TABLE "story_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"channel" text NOT NULL,
	"kind" text NOT NULL,
	"reference" text NOT NULL,
	"used_by" text NOT NULL,
	"used_at" timestamp with time zone NOT NULL,
	CONSTRAINT "story_uses_version_counted" CHECK ("story_uses"."version" >= 1),
	CONSTRAINT "story_uses_channel_known" CHECK ("story_uses"."channel" IN ('platform', 'private_circulation', 'newsletter', 'public')),
	CONSTRAINT "story_uses_kind_known" CHECK ("story_uses"."kind" IN ('markdown_export', 'pdf_page', 'pdf_binder', 'agent_read')),
	CONSTRAINT "story_uses_used_by_identity" CHECK ("story_uses"."used_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$')
);
--> statement-breakpoint
ALTER TABLE "page_versions" DROP CONSTRAINT "page_versions_type_known";--> statement-breakpoint
ALTER TABLE "pages" DROP CONSTRAINT "pages_type_known";--> statement-breakpoint
ALTER TABLE "story_consents" ADD CONSTRAINT "story_consents_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_levels" ADD CONSTRAINT "story_levels_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_media_levels" ADD CONSTRAINT "story_media_levels_file_id_page_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."page_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_media_levels" ADD CONSTRAINT "story_media_levels_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_uses" ADD CONSTRAINT "story_uses_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_media_levels_page" ON "story_media_levels" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "story_uses_page" ON "story_uses" USING btree ("page_id","used_at");--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_type_known" CHECK ("page_versions"."type" IN ('skill', 'learning', 'persona', 'product', 'system_goal', 'product_strategy', 'data_sources', 'issue', 'platform', 'decision', 'knowledge', 'entry', 'profile', 'policy', 'portfolio', 'program', 'project', 'okr', 'charter', 'resource', 'measure', 'dashboard', 'impact_story'));--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_type_known" CHECK ("pages"."type" IN ('skill', 'learning', 'persona', 'product', 'system_goal', 'product_strategy', 'data_sources', 'issue', 'platform', 'decision', 'knowledge', 'entry', 'profile', 'policy', 'portfolio', 'program', 'project', 'okr', 'charter', 'resource', 'measure', 'dashboard', 'impact_story'));