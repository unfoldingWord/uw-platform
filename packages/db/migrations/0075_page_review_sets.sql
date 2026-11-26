CREATE TABLE "page_review_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"review_set_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"request_id" uuid NOT NULL,
	"trace_id" text NOT NULL,
	"accepted_version" integer,
	CONSTRAINT "page_review_decisions_decision_known" CHECK ("page_review_decisions"."decision" IN ('accepted', 'rejected')),
	CONSTRAINT "page_review_decisions_by_human" CHECK ("page_review_decisions"."decided_by" ~ '^human:[A-Za-z0-9][A-Za-z0-9_-]*$'),
	CONSTRAINT "page_review_decisions_accepted_has_version" CHECK (("page_review_decisions"."decision" = 'accepted') = ("page_review_decisions"."accepted_version" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "page_review_sets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"page_id" uuid NOT NULL,
	"name" text NOT NULL,
	"base_version" integer NOT NULL,
	"title" text,
	"frontmatter" jsonb,
	"status" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"request_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"accepted_version" integer,
	"decision_request_id" uuid,
	CONSTRAINT "page_review_sets_status_known" CHECK ("page_review_sets"."status" IN ('pending', 'accepted', 'rejected')),
	CONSTRAINT "page_review_sets_name_present" CHECK (char_length("page_review_sets"."name") BETWEEN 1 AND 200),
	CONSTRAINT "page_review_sets_base_positive" CHECK ("page_review_sets"."base_version" >= 1),
	CONSTRAINT "page_review_sets_revision_positive" CHECK ("page_review_sets"."revision" >= 1),
	CONSTRAINT "page_review_sets_created_by_identity" CHECK ("page_review_sets"."created_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$'),
	CONSTRAINT "page_review_sets_decided_by_human" CHECK ("page_review_sets"."decided_by" IS NULL OR "page_review_sets"."decided_by" ~ '^human:[A-Za-z0-9][A-Za-z0-9_-]*$'),
	CONSTRAINT "page_review_sets_decided_together" CHECK (("page_review_sets"."status" = 'pending') = ("page_review_sets"."decided_by" IS NULL) AND ("page_review_sets"."decided_by" IS NULL) = ("page_review_sets"."decided_at" IS NULL) AND ("page_review_sets"."decided_by" IS NULL) = ("page_review_sets"."decision_request_id" IS NULL)),
	CONSTRAINT "page_review_sets_accepted_has_version" CHECK (("page_review_sets"."status" = 'accepted') = ("page_review_sets"."accepted_version" IS NOT NULL) AND ("page_review_sets"."accepted_version" IS NULL OR "page_review_sets"."accepted_version" > "page_review_sets"."base_version"))
);
--> statement-breakpoint
CREATE TABLE "page_suggested_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"review_set_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"exact" text NOT NULL,
	"prefix" text NOT NULL,
	"suffix" text NOT NULL,
	"proposed_text" text NOT NULL,
	"note" text,
	"author" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "page_suggested_changes_kind_known" CHECK ("page_suggested_changes"."kind" IN ('insertion', 'deletion', 'replacement', 'comment')),
	CONSTRAINT "page_suggested_changes_span" CHECK ("page_suggested_changes"."start_offset" >= 0 AND "page_suggested_changes"."end_offset" >= "page_suggested_changes"."start_offset" AND "page_suggested_changes"."position" >= 0),
	CONSTRAINT "page_suggested_changes_kind_fits" CHECK (CASE "page_suggested_changes"."kind"
        WHEN 'insertion' THEN "page_suggested_changes"."end_offset" = "page_suggested_changes"."start_offset" AND "page_suggested_changes"."exact" = '' AND "page_suggested_changes"."proposed_text" <> ''
        WHEN 'deletion' THEN "page_suggested_changes"."end_offset" > "page_suggested_changes"."start_offset" AND "page_suggested_changes"."proposed_text" = ''
        WHEN 'replacement' THEN "page_suggested_changes"."end_offset" > "page_suggested_changes"."start_offset" AND "page_suggested_changes"."proposed_text" <> ''
        ELSE "page_suggested_changes"."proposed_text" = '' AND "page_suggested_changes"."note" IS NOT NULL
      END),
	CONSTRAINT "page_suggested_changes_author_identity" CHECK ("page_suggested_changes"."author" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$')
);
--> statement-breakpoint
ALTER TABLE "page_review_decisions" ADD CONSTRAINT "page_review_decisions_review_set_id_page_review_sets_id_fk" FOREIGN KEY ("review_set_id") REFERENCES "public"."page_review_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_review_decisions" ADD CONSTRAINT "page_review_decisions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_review_sets" ADD CONSTRAINT "page_review_sets_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_suggested_changes" ADD CONSTRAINT "page_suggested_changes_review_set_id_page_review_sets_id_fk" FOREIGN KEY ("review_set_id") REFERENCES "public"."page_review_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "page_review_decisions_one_per_set" ON "page_review_decisions" USING btree ("review_set_id");--> statement-breakpoint
CREATE UNIQUE INDEX "page_review_sets_request" ON "page_review_sets" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "page_review_sets_one_pending_per_agent" ON "page_review_sets" USING btree ("page_id","created_by") WHERE "page_review_sets"."status" = 'pending' AND "page_review_sets"."created_by" LIKE 'agent:%';--> statement-breakpoint
CREATE INDEX "page_review_sets_page" ON "page_review_sets" USING btree ("page_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "page_suggested_changes_position" ON "page_suggested_changes" USING btree ("review_set_id","position");