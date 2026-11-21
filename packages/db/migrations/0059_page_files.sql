CREATE TABLE "page_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"page_id" uuid NOT NULL,
	"jd_area" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_files_area_form" CHECK ("page_files"."jd_area" ~ '^([0-9])0-\1[9]$'),
	CONSTRAINT "page_files_size_bounded" CHECK ("page_files"."size" BETWEEN 1 AND 20971520),
	CONSTRAINT "page_files_sha256_form" CHECK ("page_files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "page_files_uploaded_by_is_identity" CHECK ("page_files"."uploaded_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$'),
	CONSTRAINT "page_files_name_not_blank" CHECK (length(btrim("page_files"."name")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "page_files" ADD CONSTRAINT "page_files_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_files_page" ON "page_files" USING btree ("page_id");