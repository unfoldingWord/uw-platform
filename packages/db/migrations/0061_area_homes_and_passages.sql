CREATE TABLE "area_homes" (
	"area" text PRIMARY KEY NOT NULL,
	"page_id" uuid NOT NULL,
	"set_by" text NOT NULL,
	"set_at" timestamp with time zone NOT NULL,
	CONSTRAINT "area_homes_area_form" CHECK ("area_homes"."area" ~ '^([0-9])0-\1[9]$'),
	CONSTRAINT "area_homes_set_by_is_identity" CHECK ("area_homes"."set_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$')
);
--> statement-breakpoint
ALTER TABLE "page_comments" ADD COLUMN "quote" text;--> statement-breakpoint
ALTER TABLE "area_homes" ADD CONSTRAINT "area_homes_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_comments" ADD CONSTRAINT "page_comments_quote_bounded" CHECK ("page_comments"."quote" IS NULL OR length(btrim("page_comments"."quote")) BETWEEN 1 AND 500);