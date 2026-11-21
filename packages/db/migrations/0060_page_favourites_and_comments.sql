CREATE TABLE "page_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"page_id" uuid NOT NULL,
	"author" text NOT NULL,
	"body_md" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	CONSTRAINT "page_comments_author_is_identity" CHECK ("page_comments"."author" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$'),
	CONSTRAINT "page_comments_body_bounded" CHECK (length(btrim("page_comments"."body_md")) BETWEEN 1 AND 10000),
	CONSTRAINT "page_comments_resolved_together" CHECK (("page_comments"."resolved_at" IS NULL) = ("page_comments"."resolved_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "page_favourites" (
	"person_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_favourites_pkey" PRIMARY KEY("person_id","page_id")
);
--> statement-breakpoint
ALTER TABLE "page_comments" ADD CONSTRAINT "page_comments_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_favourites" ADD CONSTRAINT "page_favourites_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_favourites" ADD CONSTRAINT "page_favourites_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_comments_page" ON "page_comments" USING btree ("page_id","created_at");