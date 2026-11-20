CREATE TABLE "page_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_page" uuid NOT NULL,
	"to_page" uuid,
	"rel" text NOT NULL,
	"wanted" text,
	CONSTRAINT "page_links_rel_known" CHECK ("page_links"."rel" IN ('links', 'embeds', 'unresolved')),
	CONSTRAINT "page_links_unresolved_names_no_page" CHECK (("page_links"."rel" = 'unresolved') = ("page_links"."to_page" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_from_page_pages_id_fk" FOREIGN KEY ("from_page") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_to_page_pages_id_fk" FOREIGN KEY ("to_page") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_links_from" ON "page_links" USING btree ("from_page");--> statement-breakpoint
CREATE INDEX "page_links_to" ON "page_links" USING btree ("to_page","rel");