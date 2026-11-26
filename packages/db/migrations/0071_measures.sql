CREATE TABLE "measure_activations" (
	"measure_page_id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"tool_hash" text NOT NULL,
	"lock" text NOT NULL,
	"lock_sha256" text NOT NULL,
	"activator_person_id" uuid NOT NULL,
	"area" text NOT NULL,
	"activated_at" timestamp with time zone NOT NULL,
	"next_run_at" timestamp with time zone,
	"paused_reason" text,
	CONSTRAINT "measure_activations_version_counted" CHECK ("measure_activations"."version" >= 1),
	CONSTRAINT "measure_activations_tool_hash_form" CHECK ("measure_activations"."tool_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "measure_activations_lock_sha256_form" CHECK ("measure_activations"."lock_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "measure_activations_area_form" CHECK ("measure_activations"."area" ~ '^([0-9])0-\1[9]$'),
	CONSTRAINT "measure_activations_paused_reason_known" CHECK ("measure_activations"."paused_reason" IN ('changed', 'activator_lost_access', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "measure_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"measure_page_id" uuid NOT NULL,
	"measure_version" integer NOT NULL,
	"tool_hash" text NOT NULL,
	"kind" text NOT NULL,
	"requested_by" text NOT NULL,
	"state" text NOT NULL,
	"lock" text,
	"lock_sha256" text,
	"refused_hosts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"area" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "measure_runs_version_counted" CHECK ("measure_runs"."measure_version" >= 1),
	CONSTRAINT "measure_runs_tool_hash_form" CHECK ("measure_runs"."tool_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "measure_runs_kind_known" CHECK ("measure_runs"."kind" IN ('trial', 'scheduled', 'requested')),
	CONSTRAINT "measure_runs_state_known" CHECK ("measure_runs"."state" IN ('queued', 'running', 'ok', 'partial', 'failed', 'not_wired')),
	CONSTRAINT "measure_runs_requested_by_identity" CHECK ("measure_runs"."requested_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$'),
	CONSTRAINT "measure_runs_lock_sha256_form" CHECK ("measure_runs"."lock_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "measure_runs_lock_hashed" CHECK (("measure_runs"."lock" IS NULL) = ("measure_runs"."lock_sha256" IS NULL)),
	CONSTRAINT "measure_runs_refused_hosts_list" CHECK (jsonb_typeof("measure_runs"."refused_hosts") = 'array'),
	CONSTRAINT "measure_runs_area_form" CHECK ("measure_runs"."area" ~ '^([0-9])0-\1[9]$'),
	CONSTRAINT "measure_runs_finished_has_time" CHECK ("measure_runs"."state" NOT IN ('ok', 'partial', 'failed') OR "measure_runs"."finished_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"measure_page_id" uuid NOT NULL,
	"measure_version" integer NOT NULL,
	"resource_page_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"tool_version" text,
	"values" jsonb,
	"outcome" text NOT NULL,
	"reason" text,
	"raw_key" text,
	"raw_sha256" text,
	"area" text NOT NULL,
	CONSTRAINT "observations_version_counted" CHECK ("observations"."measure_version" >= 1),
	CONSTRAINT "observations_outcome_known" CHECK ("observations"."outcome" IN ('ok', 'failed')),
	CONSTRAINT "observations_reason_known" CHECK ("observations"."reason" IN ('timed_out', 'tool_failed', 'output_not_json', 'output_unfit', 'unreachable', 'host_refused')),
	CONSTRAINT "observations_ok_has_values" CHECK ("observations"."outcome" <> 'ok' OR ("observations"."values" IS NOT NULL AND "observations"."reason" IS NULL)),
	CONSTRAINT "observations_failed_has_reason" CHECK ("observations"."outcome" <> 'failed' OR ("observations"."reason" IS NOT NULL AND "observations"."values" IS NULL)),
	CONSTRAINT "observations_values_object" CHECK (jsonb_typeof("observations"."values") = 'object'),
	CONSTRAINT "observations_raw_hashed" CHECK (("observations"."raw_key" IS NULL) = ("observations"."raw_sha256" IS NULL)),
	CONSTRAINT "observations_raw_sha256_form" CHECK ("observations"."raw_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "observations_area_form" CHECK ("observations"."area" ~ '^([0-9])0-\1[9]$')
);
--> statement-breakpoint
ALTER TABLE "page_versions" DROP CONSTRAINT "page_versions_type_known";--> statement-breakpoint
ALTER TABLE "pages" DROP CONSTRAINT "pages_type_known";--> statement-breakpoint
ALTER TABLE "measure_activations" ADD CONSTRAINT "measure_activations_measure_page_id_pages_id_fk" FOREIGN KEY ("measure_page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measure_activations" ADD CONSTRAINT "measure_activations_activator_person_id_people_id_fk" FOREIGN KEY ("activator_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measure_runs" ADD CONSTRAINT "measure_runs_measure_page_id_pages_id_fk" FOREIGN KEY ("measure_page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_run_id_measure_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."measure_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_measure_page_id_pages_id_fk" FOREIGN KEY ("measure_page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_resource_page_id_pages_id_fk" FOREIGN KEY ("resource_page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "measure_activations_due" ON "measure_activations" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "measure_runs_by_measure" ON "measure_runs" USING btree ("measure_page_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "observations_one_per_run" ON "observations" USING btree ("run_id","resource_page_id");--> statement-breakpoint
CREATE INDEX "observations_by_resource" ON "observations" USING btree ("measure_page_id","resource_page_id","observed_at");--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_type_known" CHECK ("page_versions"."type" IN ('skill', 'learning', 'persona', 'product', 'system_goal', 'product_strategy', 'data_sources', 'issue', 'platform', 'knowledge', 'entry', 'profile', 'portfolio', 'program', 'project', 'okr', 'resource', 'measure', 'dashboard'));--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_type_known" CHECK ("pages"."type" IN ('skill', 'learning', 'persona', 'product', 'system_goal', 'product_strategy', 'data_sources', 'issue', 'platform', 'knowledge', 'entry', 'profile', 'portfolio', 'program', 'project', 'okr', 'resource', 'measure', 'dashboard'));