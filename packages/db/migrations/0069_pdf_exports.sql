CREATE TABLE "pdf_exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"reference" text NOT NULL,
	"requested_by" text NOT NULL,
	"person_id" uuid,
	"areas" text[] NOT NULL,
	"request" jsonb NOT NULL,
	"r2_key" text,
	"source_sha256" text,
	"file_sha256" text,
	"bytes" integer,
	"failure" text,
	"created_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pdf_exports_kind_known" CHECK ("pdf_exports"."kind" IN ('page', 'view', 'screen', 'binder')),
	CONSTRAINT "pdf_exports_status_known" CHECK ("pdf_exports"."status" IN ('queued', 'ready', 'failed', 'expired')),
	CONSTRAINT "pdf_exports_requested_by_identity" CHECK ("pdf_exports"."requested_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$'),
	CONSTRAINT "pdf_exports_source_sha256_form" CHECK ("pdf_exports"."source_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "pdf_exports_file_sha256_form" CHECK ("pdf_exports"."file_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "pdf_exports_bytes_counted" CHECK ("pdf_exports"."bytes" >= 0),
	CONSTRAINT "pdf_exports_failure_form" CHECK ("pdf_exports"."failure" ~ '^[a-z][a-z_]*$'),
	CONSTRAINT "pdf_exports_ready_has_file" CHECK ("pdf_exports"."status" <> 'ready' OR (("pdf_exports"."r2_key" IS NOT NULL OR "pdf_exports"."kind" = 'screen') AND "pdf_exports"."source_sha256" IS NOT NULL AND "pdf_exports"."file_sha256" IS NOT NULL AND "pdf_exports"."bytes" IS NOT NULL AND "pdf_exports"."finished_at" IS NOT NULL)),
	CONSTRAINT "pdf_exports_screen_never_stored" CHECK ("pdf_exports"."kind" <> 'screen' OR "pdf_exports"."r2_key" IS NULL),
	CONSTRAINT "pdf_exports_failed_has_reason" CHECK ("pdf_exports"."status" <> 'failed' OR "pdf_exports"."failure" IS NOT NULL),
	CONSTRAINT "pdf_exports_expires_after_creation" CHECK ("pdf_exports"."expires_at" > "pdf_exports"."created_at")
);
--> statement-breakpoint
ALTER TABLE "pdf_exports" ADD CONSTRAINT "pdf_exports_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pdf_exports_expiry" ON "pdf_exports" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "pdf_exports_renders_by_person" ON "pdf_exports" USING btree ("person_id","created_at");