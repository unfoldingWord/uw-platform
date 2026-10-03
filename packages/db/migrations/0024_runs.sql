ALTER TABLE "harness_runs" ADD COLUMN "persona_page_id" uuid;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "delegation_id" uuid;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "pinned_provider" text;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "compute_minor" bigint;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "hibernated_for" text;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "failure" text;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "gates" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD COLUMN "prompts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD CONSTRAINT "harness_runs_persona_page_id_pages_id_fk" FOREIGN KEY ("persona_page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD CONSTRAINT "harness_runs_delegation_id_delegations_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."delegations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "harness_events_breaker_latest" ON "harness_events" USING btree ("harness_id","at","position") WHERE "harness_events"."name" IN ('breaker_open', 'breaker_holding', 'breaker_pausing');--> statement-breakpoint
CREATE UNIQUE INDEX "harness_runs_one_live_per_item" ON "harness_runs" USING btree ("item_id") WHERE "harness_runs"."outcome" IN ('running', 'hibernated');--> statement-breakpoint
CREATE INDEX "harness_runs_live" ON "harness_runs" USING btree ("harness_id") WHERE "harness_runs"."outcome" IN ('running', 'hibernated');--> statement-breakpoint
ALTER TABLE "harness_runs" ADD CONSTRAINT "harness_runs_hibernated_for_known" CHECK ("harness_runs"."hibernated_for" IN ('gate', 'paused', 'breaker'));--> statement-breakpoint
ALTER TABLE "harness_runs" ADD CONSTRAINT "harness_runs_hibernated_has_why" CHECK (("harness_runs"."outcome" = 'hibernated') = ("harness_runs"."hibernated_for" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "harness_runs" ADD CONSTRAINT "harness_runs_failure_known" CHECK ("harness_runs"."failure" IN ('retries_exhausted', 'provider_mismatch', 'start_failed', 'turn_limit'));--> statement-breakpoint
ALTER TABLE "harness_runs" ADD CONSTRAINT "harness_runs_subscription_has_no_cost" CHECK ("harness_runs"."cost_basis" <> 'subscription' OR ("harness_runs"."cost_minor" IS NULL AND "harness_runs"."compute_minor" IS NULL));--> statement-breakpoint
ALTER TABLE "harness_runs" ADD CONSTRAINT "harness_runs_shape_matches_engine" CHECK (("harness_runs"."run_shape" = 'external-run') = ("harness_runs"."engine" = 'external'));--> statement-breakpoint
ALTER TABLE "harness_runs" ADD CONSTRAINT "harness_runs_steps_bounded" CHECK (jsonb_typeof("harness_runs"."steps") = 'array' AND jsonb_array_length("harness_runs"."steps") <= 200);--> statement-breakpoint
ALTER TABLE "harness_runs" ADD CONSTRAINT "harness_runs_prompts_bounded" CHECK (jsonb_typeof("harness_runs"."prompts") = 'array' AND jsonb_array_length("harness_runs"."prompts") <= 20);