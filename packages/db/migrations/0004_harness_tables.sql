CREATE TABLE "delegations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"persona" text NOT NULL,
	"harness_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"lapsed_at" timestamp with time zone,
	"supersedes" uuid,
	"trace_id" uuid NOT NULL,
	CONSTRAINT "delegations_capability_known" CHECK ("delegations"."capability" IN ('none', 'iterate', 'build', 'review')),
	CONSTRAINT "delegations_persona_form" CHECK ("delegations"."persona" ~ '^agent:[A-Za-z0-9][A-Za-z0-9_-]*$'),
	CONSTRAINT "delegations_expires_after_grant" CHECK ("delegations"."expires_at" > "delegations"."granted_at")
);
--> statement-breakpoint
CREATE TABLE "gate_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"harness_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"evidence" jsonb NOT NULL,
	"trace_id" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gate_decisions_decision_known" CHECK ("gate_decisions"."decision" IN ('approve', 'reject', 'take_over', 'override')),
	CONSTRAINT "gate_decisions_actor_is_human" CHECK ("gate_decisions"."actor" ~ '^human:[A-Za-z0-9][A-Za-z0-9_-]*$'),
	CONSTRAINT "gate_decisions_override_has_reason" CHECK ("gate_decisions"."decision" <> 'override' OR length(btrim(coalesce("gate_decisions"."reason", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "harness_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"harness_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"title" text NOT NULL,
	"page_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"due" date,
	"claimed_by" text,
	"claimant_kind" text,
	"delegation_id" uuid,
	"lease_expires" timestamp with time zone,
	"gate_status" text DEFAULT 'working' NOT NULL,
	"gate_target" text,
	"risk_tier" text,
	"risk_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"expected_head" text,
	"branch_state" text DEFAULT 'none' NOT NULL,
	"pr_repo" text,
	"pr_number" integer,
	"zulip_topic" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "harness_items_harness_and_id" UNIQUE("harness_id","id"),
	CONSTRAINT "harness_items_claimant_kind_known" CHECK ("harness_items"."claimant_kind" IN ('person', 'agent')),
	CONSTRAINT "harness_items_holder_has_kind" CHECK (("harness_items"."claimed_by" IS NULL) = ("harness_items"."claimant_kind" IS NULL)),
	CONSTRAINT "harness_items_claimed_by_is_identity" CHECK ("harness_items"."claimed_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[A-Za-z0-9][A-Za-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[A-Za-z0-9][A-Za-z0-9_-]* as [A-Za-z0-9][A-Za-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$'),
	CONSTRAINT "harness_items_lease_only_when_held" CHECK ("harness_items"."lease_expires" IS NULL OR "harness_items"."claimed_by" IS NOT NULL),
	CONSTRAINT "harness_items_person_has_no_lease" CHECK ("harness_items"."claimant_kind" IS DISTINCT FROM 'person' OR "harness_items"."lease_expires" IS NULL),
	CONSTRAINT "harness_items_gate_status_known" CHECK ("harness_items"."gate_status" IN ('working', 'parked', 'checks_failed', 'done')),
	CONSTRAINT "harness_items_gate_target_form" CHECK ("harness_items"."gate_target" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "harness_items_branch_state_known" CHECK ("harness_items"."branch_state" IN ('none', 'active', 'abandoned')),
	CONSTRAINT "harness_items_risk_tier_known" CHECK ("harness_items"."risk_tier" IN ('low', 'standard', 'high')),
	CONSTRAINT "harness_items_risk_domains_known" CHECK ("harness_items"."risk_domains" <@ ARRAY['ledger', 'acl', 'infra', 'migration']::text[]),
	CONSTRAINT "harness_items_pr_whole" CHECK (("harness_items"."pr_repo" IS NULL) = ("harness_items"."pr_number" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "harness_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"harness_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"persona" text NOT NULL,
	"run_shape" text NOT NULL,
	"engine" text NOT NULL,
	"model" text NOT NULL,
	"resolved_provider" text,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cost_minor" bigint,
	"cost_basis" text NOT NULL,
	"trace_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "harness_runs_persona_form" CHECK ("harness_runs"."persona" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[A-Za-z0-9][A-Za-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[A-Za-z0-9][A-Za-z0-9_-]* as [A-Za-z0-9][A-Za-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$'),
	CONSTRAINT "harness_runs_run_shape_known" CHECK ("harness_runs"."run_shape" IN ('workflow-run', 'external-run')),
	CONSTRAINT "harness_runs_engine_known" CHECK ("harness_runs"."engine" IN ('claude-messages', 'claude-code-sandbox', 'claude-managed-agent', 'codex-sandbox', 'external', 'openrouter-messages')),
	CONSTRAINT "harness_runs_cost_basis_known" CHECK ("harness_runs"."cost_basis" IN ('metered', 'subscription')),
	CONSTRAINT "harness_runs_outcome_known" CHECK ("harness_runs"."outcome" IN ('running', 'hibernated', 'stopped', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "harness_stages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"harness_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"bracket" text NOT NULL,
	"agent_pickup" text NOT NULL,
	"exit_gate" text NOT NULL,
	"connector" text DEFAULT 'none' NOT NULL,
	"wip_limit" integer DEFAULT 3 NOT NULL,
	"instructions_page_id" uuid,
	"validators" text[] DEFAULT '{}'::text[] NOT NULL,
	"feeds" text[] DEFAULT '{}'::text[] NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	CONSTRAINT "harness_stages_harness_and_id" UNIQUE("harness_id","id"),
	CONSTRAINT "harness_stages_effect_needs_human_gate" CHECK ("harness_stages"."connector" = 'none' OR "harness_stages"."exit_gate" = 'human_approval'),
	CONSTRAINT "harness_stages_connector_known" CHECK ("harness_stages"."connector" IN ('none', 'merge', 'deploy', 'publish', 'send', 'post')),
	CONSTRAINT "harness_stages_exit_gate_known" CHECK ("harness_stages"."exit_gate" IN ('none', 'checks', 'human_approval')),
	CONSTRAINT "harness_stages_agent_pickup_known" CHECK ("harness_stages"."agent_pickup" IN ('none', 'allowed', 'auto')),
	CONSTRAINT "harness_stages_bracket_known" CHECK ("harness_stages"."bracket" IN ('product_package', 'build_package', 'deploy_package', 'iterate')),
	CONSTRAINT "harness_stages_key_form" CHECK ("harness_stages"."key" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "harness_stages_position_positive" CHECK ("harness_stages"."position" > 0),
	CONSTRAINT "harness_stages_wip_limit_positive" CHECK ("harness_stages"."wip_limit" >= 1)
);
--> statement-breakpoint
CREATE TABLE "harnesses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"template" text NOT NULL,
	"jd_area" text NOT NULL,
	"hosted_builder_enabled" boolean DEFAULT false NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "harnesses_key_unique" UNIQUE("key"),
	CONSTRAINT "harnesses_area_form" CHECK ("harnesses"."jd_area" ~ '^([0-9])0-\1[9]$'),
	CONSTRAINT "harnesses_key_form" CHECK ("harnesses"."key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "harnesses_template_form" CHECK ("harnesses"."template" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "measurements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"harness_id" uuid NOT NULL,
	"item_id" uuid,
	"source" text NOT NULL,
	"name" text NOT NULL,
	"value" double precision NOT NULL,
	"as_of" date NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "measurements_source_known" CHECK ("measurements"."source" IN ('web_analytics', 'mailing_list', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"identity" text PRIMARY KEY NOT NULL,
	"harness_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	CONSTRAINT "personas_page_id_unique" UNIQUE("page_id"),
	CONSTRAINT "personas_identity_form" CHECK ("personas"."identity" ~ '^agent:[A-Za-z0-9][A-Za-z0-9_-]*$')
);
--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_harness_id_harnesses_id_fk" FOREIGN KEY ("harness_id") REFERENCES "public"."harnesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_supersedes_fk" FOREIGN KEY ("supersedes") REFERENCES "public"."delegations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_decisions" ADD CONSTRAINT "gate_decisions_item_fk" FOREIGN KEY ("harness_id","item_id") REFERENCES "public"."harness_items"("harness_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_decisions" ADD CONSTRAINT "gate_decisions_stage_fk" FOREIGN KEY ("harness_id","stage_id") REFERENCES "public"."harness_stages"("harness_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_items" ADD CONSTRAINT "harness_items_harness_id_harnesses_id_fk" FOREIGN KEY ("harness_id") REFERENCES "public"."harnesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_items" ADD CONSTRAINT "harness_items_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_items" ADD CONSTRAINT "harness_items_delegation_id_delegations_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."delegations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_items" ADD CONSTRAINT "harness_items_stage_fk" FOREIGN KEY ("harness_id","stage_id") REFERENCES "public"."harness_stages"("harness_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_runs" ADD CONSTRAINT "harness_runs_item_fk" FOREIGN KEY ("harness_id","item_id") REFERENCES "public"."harness_items"("harness_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_stages" ADD CONSTRAINT "harness_stages_harness_id_harnesses_id_fk" FOREIGN KEY ("harness_id") REFERENCES "public"."harnesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_stages" ADD CONSTRAINT "harness_stages_instructions_page_id_pages_id_fk" FOREIGN KEY ("instructions_page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_harness_id_harnesses_id_fk" FOREIGN KEY ("harness_id") REFERENCES "public"."harnesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_item_fk" FOREIGN KEY ("harness_id","item_id") REFERENCES "public"."harness_items"("harness_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_harness_id_harnesses_id_fk" FOREIGN KEY ("harness_id") REFERENCES "public"."harnesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delegations_person" ON "delegations" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "delegations_harness" ON "delegations" USING btree ("harness_id");--> statement-breakpoint
CREATE INDEX "gate_decisions_item" ON "gate_decisions" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "harness_items_stage" ON "harness_items" USING btree ("harness_id","stage_id");--> statement-breakpoint
CREATE INDEX "harness_items_lease" ON "harness_items" USING btree ("lease_expires");--> statement-breakpoint
CREATE INDEX "harness_runs_item" ON "harness_runs" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "harness_stages_key_per_harness" ON "harness_stages" USING btree ("harness_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "harness_stages_position_per_harness" ON "harness_stages" USING btree ("harness_id","position");--> statement-breakpoint
CREATE INDEX "measurements_item" ON "measurements" USING btree ("item_id");