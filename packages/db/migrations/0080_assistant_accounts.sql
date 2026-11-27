CREATE TABLE "assistant_accounts" (
	"harness_id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"name" text NOT NULL,
	"jd_id" text,
	"status" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_accounts_status_known" CHECK ("assistant_accounts"."status" IN ('enabled', 'disabled', 'deleted')),
	CONSTRAINT "assistant_accounts_name_shape" CHECK ("assistant_accounts"."name" ~ '^[a-z0-9][a-z0-9.-]{0,28}[a-z0-9]$' AND position('..' in "assistant_accounts"."name") = 0),
	CONSTRAINT "assistant_accounts_jd_id_range" CHECK ("assistant_accounts"."jd_id" ~ '^10\.(5[1-9]|[6-9][0-9]|[1-9][0-9]{2})$'),
	CONSTRAINT "assistant_accounts_jd_id_until_deleted" CHECK (("assistant_accounts"."status" = 'deleted') = ("assistant_accounts"."jd_id" IS NULL)),
	CONSTRAINT "assistant_accounts_disabled_has_time" CHECK (("assistant_accounts"."status" = 'enabled') = ("assistant_accounts"."disabled_at" IS NULL)),
	CONSTRAINT "assistant_accounts_deleted_has_time" CHECK (("assistant_accounts"."status" = 'deleted') = ("assistant_accounts"."deleted_at" IS NOT NULL)),
	CONSTRAINT "assistant_accounts_version_positive" CHECK ("assistant_accounts"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "assistant_provisioning" (
	"harness_id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"account_version" integer NOT NULL,
	"step" text NOT NULL,
	"status" text NOT NULL,
	"failure" text,
	"attempts" integer NOT NULL,
	"next_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_provisioning_step_known" CHECK ("assistant_provisioning"."step" IN ('workspace_user', 'zulip_bot', 'persona', 'assist', 'suspend_user', 'deactivate_bot', 'delete_user')),
	CONSTRAINT "assistant_provisioning_status_known" CHECK ("assistant_provisioning"."status" IN ('working', 'waiting', 'done', 'failed')),
	CONSTRAINT "assistant_provisioning_failure_known" CHECK ("assistant_provisioning"."failure" IS NULL OR "assistant_provisioning"."failure" IN ('name_taken', 'workspace_refused', 'workspace_unavailable', 'workspace_not_wired', 'zulip_refused', 'zulip_rate_limited', 'zulip_unknown', 'zulip_not_wired', 'key_not_sealed', 'persona_refused', 'person_inactive')),
	CONSTRAINT "assistant_provisioning_failed_has_reason" CHECK (("assistant_provisioning"."status" = 'failed') = ("assistant_provisioning"."failure" IS NOT NULL)),
	CONSTRAINT "assistant_provisioning_attempts_bounded" CHECK ("assistant_provisioning"."attempts" BETWEEN 0 AND 100000)
);
--> statement-breakpoint
ALTER TABLE "harness_events" DROP CONSTRAINT "harness_events_name_known";--> statement-breakpoint
ALTER TABLE "assistant_accounts" ADD CONSTRAINT "assistant_accounts_personal_harness_fk" FOREIGN KEY ("harness_id","person_id") REFERENCES "public"."harnesses"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_provisioning" ADD CONSTRAINT "assistant_provisioning_personal_harness_fk" FOREIGN KEY ("harness_id","person_id") REFERENCES "public"."harnesses"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_accounts_jd_id_once" ON "assistant_accounts" USING btree ("jd_id") WHERE "assistant_accounts"."jd_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_accounts_name_once" ON "assistant_accounts" USING btree ("name") WHERE "assistant_accounts"."status" <> 'deleted';--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_accounts_person_once" ON "assistant_accounts" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "assistant_accounts_disabled" ON "assistant_accounts" USING btree ("status","disabled_at");--> statement-breakpoint
CREATE INDEX "assistant_provisioning_next" ON "assistant_provisioning" USING btree ("next_at");--> statement-breakpoint
ALTER TABLE "harness_events" ADD CONSTRAINT "harness_events_name_known" CHECK ("harness_events"."name" IN ('item_created', 'item_claimed', 'item_released', 'item_reordered', 'lease_renewed', 'lease_expired', 'branch_abandoned', 'branch_adopted', 'stage_advanced', 'loop_edge_taken', 'premise_held', 'risk_derived', 'label_removed', 'run_started', 'run_step_recorded', 'run_failed', 'run_hibernated', 'run_resumed', 'run_stopped', 'run_completed', 'run_prompted', 'submitted_to_gate', 'checks_passed', 'checks_failed', 'gate_approved', 'gate_rejected', 'gate_taken_over', 'gate_overridden', 'gate_refused_to_agent', 'ship_refused', 'connector_succeeded', 'connector_refused', 'delegation_granted', 'delegation_revoked', 'delegation_lapsed', 'delegation_required', 'stage_edit_refused', 'stage_edited', 'stage_removed', 'workflow_draft_opened', 'workflow_draft_saved', 'workflow_draft_taken_over', 'workflow_draft_discarded', 'workflow_published', 'template_activated', 'harness_paused', 'harness_resumed', 'hosted_builder_set', 'learning_attached', 'nothing_learned', 'comment_recorded', 'zulip_topic_linked', 'breaker_holding', 'breaker_pausing', 'breaker_open', 'persona_activation_failed', 'persona_activated', 'measurement_recorded', 'handed_to_person', 'review_verdict_recorded', 'shadow_verdict', 'shadow_lifted', 'shadow_turned_on', 'freeze_changed', 'finding_refuted', 'delegated_merge', 'delegated_exit_claimed', 'fix_claimed', 'fix_claim_set', 'title_set', 'epic_enqueued', 'done_when_missing', 'silence_alarm', 'template_changed', 'assistant_customised', 'assistant_request_recorded', 'assistant_turn_started', 'assistant_turn_refused', 'assistant_turn_finished', 'assistant_effect_started', 'assistant_effect_done', 'assistant_effect_failed', 'assistant_reminder_set', 'assistant_reminder_cancelled', 'assistant_reminder_fired', 'assistant_reminder_undelivered', 'assistant_pairing_started', 'assistant_paired', 'assistant_pairing_refused', 'assistant_budget_set', 'assistant_hold_placed', 'assistant_hold_released', 'assistant_enabled', 'assistant_disabled', 'assistant_provisioned', 'assistant_provisioning_failed', 'assistant_deleted'));