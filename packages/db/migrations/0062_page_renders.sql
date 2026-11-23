CREATE TABLE "page_renders" (
	"page_id" uuid NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"html" text NOT NULL,
	"headings" jsonb NOT NULL,
	"rendered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "page_renders_pkey" PRIMARY KEY("page_id","key"),
	CONSTRAINT "page_renders_key_form" CHECK ("page_renders"."key" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "page_renders" ADD CONSTRAINT "page_renders_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_renders_rendered" ON "page_renders" USING btree ("rendered_at");