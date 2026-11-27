CREATE TABLE "story_expressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"title" text NOT NULL,
	"format" text NOT NULL,
	"venue" text NOT NULL,
	"channel" text NOT NULL,
	"kind" text NOT NULL,
	"url" text,
	"page_id_native" uuid,
	"language" text,
	"published_on" date,
	"excerpt" text,
	"status" text NOT NULL,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	CONSTRAINT "story_expressions_format_known" CHECK ("story_expressions"."format" IN ('social_post', 'newsletter_article', 'annual_report', 'web_page', 'blog_post', 'video', 'audio', 'presentation', 'grant_report', 'board_report', 'email', 'print', 'other')),
	CONSTRAINT "story_expressions_channel_known" CHECK ("story_expressions"."channel" IN ('platform', 'private_circulation', 'newsletter', 'public')),
	CONSTRAINT "story_expressions_kind_known" CHECK ("story_expressions"."kind" IN ('link', 'native')),
	CONSTRAINT "story_expressions_status_known" CHECK ("story_expressions"."status" IN ('suggested', 'confirmed', 'retired')),
	CONSTRAINT "story_expressions_one_location" CHECK (("story_expressions"."kind" = 'link' AND "story_expressions"."url" IS NOT NULL AND "story_expressions"."page_id_native" IS NULL) OR ("story_expressions"."kind" = 'native' AND "story_expressions"."url" IS NULL AND "story_expressions"."page_id_native" IS NOT NULL)),
	CONSTRAINT "story_expressions_url_https" CHECK ("story_expressions"."url" IS NULL OR "story_expressions"."url" LIKE 'https://%'),
	CONSTRAINT "story_expressions_title_given" CHECK (length(trim("story_expressions"."title")) > 0),
	CONSTRAINT "story_expressions_venue_given" CHECK (length(trim("story_expressions"."venue")) > 0),
	CONSTRAINT "story_expressions_excerpt_short" CHECK ("story_expressions"."excerpt" IS NULL OR length("story_expressions"."excerpt") <= 1000),
	CONSTRAINT "story_expressions_added_by_identity" CHECK ("story_expressions"."added_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$'),
	CONSTRAINT "story_expressions_decided_together" CHECK (("story_expressions"."decided_by" IS NULL) = ("story_expressions"."decided_at" IS NULL)),
	CONSTRAINT "story_expressions_decided_by_identity" CHECK ("story_expressions"."decided_by" IS NULL OR "story_expressions"."decided_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$')
);
--> statement-breakpoint
ALTER TABLE "story_expressions" ADD CONSTRAINT "story_expressions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_expressions" ADD CONSTRAINT "story_expressions_page_id_native_pages_id_fk" FOREIGN KEY ("page_id_native") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "story_expressions_page_url" ON "story_expressions" USING btree ("page_id","url");--> statement-breakpoint
CREATE INDEX "story_expressions_page" ON "story_expressions" USING btree ("page_id","published_on");