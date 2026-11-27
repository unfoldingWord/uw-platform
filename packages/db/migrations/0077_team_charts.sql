CREATE TABLE "person_commitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_person_id" uuid NOT NULL,
	"to_person_id" uuid,
	"to_text" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "person_commitments_one_target" CHECK (("person_commitments"."to_person_id" IS NULL) <> ("person_commitments"."to_text" IS NULL)),
	CONSTRAINT "person_commitments_to_text_bounded" CHECK ("person_commitments"."to_text" IS NULL OR length(btrim("person_commitments"."to_text")) BETWEEN 1 AND 200),
	CONSTRAINT "person_commitments_not_to_self" CHECK ("person_commitments"."to_person_id" IS NULL OR "person_commitments"."to_person_id" <> "person_commitments"."from_person_id"),
	CONSTRAINT "person_commitments_updated_by_is_identity" CHECK ("person_commitments"."updated_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$')
);
--> statement-breakpoint
CREATE TABLE "staff_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"program_page_id" uuid,
	"portfolio_page_id" uuid,
	"percent" integer,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "staff_allocations_one_target" CHECK (("staff_allocations"."program_page_id" IS NULL) <> ("staff_allocations"."portfolio_page_id" IS NULL)),
	CONSTRAINT "staff_allocations_percent_range" CHECK ("staff_allocations"."percent" IS NULL OR "staff_allocations"."percent" BETWEEN 0 AND 100),
	CONSTRAINT "staff_allocations_updated_by_is_identity" CHECK ("staff_allocations"."updated_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$')
);
--> statement-breakpoint
ALTER TABLE "person_commitments" ADD CONSTRAINT "person_commitments_from_person_id_people_id_fk" FOREIGN KEY ("from_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_commitments" ADD CONSTRAINT "person_commitments_to_person_id_people_id_fk" FOREIGN KEY ("to_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_allocations" ADD CONSTRAINT "staff_allocations_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_allocations" ADD CONSTRAINT "staff_allocations_program_page_id_pages_id_fk" FOREIGN KEY ("program_page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_allocations" ADD CONSTRAINT "staff_allocations_portfolio_page_id_pages_id_fk" FOREIGN KEY ("portfolio_page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "person_commitments_one_per_pair" ON "person_commitments" USING btree ("from_person_id","to_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_allocations_one_per_program" ON "staff_allocations" USING btree ("person_id","program_page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_allocations_one_per_portfolio" ON "staff_allocations" USING btree ("person_id","portfolio_page_id");