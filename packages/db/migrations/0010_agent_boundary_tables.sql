CREATE TABLE "service_tokens" (
	"client_id" text PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"device" text NOT NULL,
	"bound_by" text NOT NULL,
	"bound_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"trace_id" uuid NOT NULL,
	CONSTRAINT "service_tokens_device_form" CHECK ("service_tokens"."device" ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
	CONSTRAINT "service_tokens_bound_by_is_human" CHECK ("service_tokens"."bound_by" ~ '^human:[A-Za-z0-9][A-Za-z0-9_-]*$')
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"jd_area" text NOT NULL,
	"title" text NOT NULL,
	"page_id" uuid,
	"due" date,
	"status" text NOT NULL,
	"created_by" text NOT NULL,
	"trace_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tasks_status_known" CHECK ("tasks"."status" IN ('suggested', 'open', 'done', 'dismissed')),
	CONSTRAINT "tasks_area_form" CHECK ("tasks"."jd_area" ~ '^([0-9])0-\1[9]$'),
	CONSTRAINT "tasks_created_by_is_identity" CHECK ("tasks"."created_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[A-Za-z0-9][A-Za-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[A-Za-z0-9][A-Za-z0-9_-]* as [A-Za-z0-9][A-Za-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$'),
	CONSTRAINT "tasks_title_not_blank" CHECK (length(btrim("tasks"."title")) > 0)
);
--> statement-breakpoint
ALTER TABLE "service_tokens" ADD CONSTRAINT "service_tokens_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_tokens_one_live_device" ON "service_tokens" USING btree ("person_id","device") WHERE "service_tokens"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "tasks_area_status" ON "tasks" USING btree ("jd_area","status");