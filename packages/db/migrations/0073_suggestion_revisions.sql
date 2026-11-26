ALTER TABLE "page_suggestion_sets" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "page_suggestion_sets" ADD COLUMN "decision_request_id" uuid;--> statement-breakpoint
ALTER TABLE "page_suggestion_sets" ADD CONSTRAINT "page_suggestion_sets_revision_positive" CHECK ("page_suggestion_sets"."revision" >= 1);--> statement-breakpoint
ALTER TABLE "page_suggestion_sets" ADD CONSTRAINT "page_suggestion_sets_decision_request_when_decided" CHECK (("page_suggestion_sets"."status" = 'pending') = ("page_suggestion_sets"."decision_request_id" IS NULL));