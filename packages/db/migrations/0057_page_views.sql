CREATE TABLE "page_views" (
	"person_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "page_views_pkey" PRIMARY KEY("person_id","page_id")
);
--> statement-breakpoint
ALTER TABLE "page_views" ADD CONSTRAINT "page_views_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_views" ADD CONSTRAINT "page_views_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_views_recent" ON "page_views" USING btree ("person_id","viewed_at");