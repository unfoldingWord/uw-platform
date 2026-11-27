CREATE TABLE "assistant_reminders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"harness_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"effect_id" uuid NOT NULL,
	"text" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_reminders_status_known" CHECK ("assistant_reminders"."status" IN ('set', 'fired', 'cancelled', 'undelivered')),
	CONSTRAINT "assistant_reminders_closed_when_done" CHECK (("assistant_reminders"."status" = 'set') = ("assistant_reminders"."closed_at" IS NULL)),
	CONSTRAINT "assistant_reminders_text_length" CHECK (char_length("assistant_reminders"."text") BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "harness_events" DROP CONSTRAINT "harness_events_name_known";--> statement-breakpoint
ALTER TABLE "assistant_effects" ADD CONSTRAINT "assistant_effects_id_harness" UNIQUE("id","harness_id");--> statement-breakpoint
ALTER TABLE "assistant_reminders" ADD CONSTRAINT "assistant_reminders_personal_harness_fk" FOREIGN KEY ("harness_id","person_id") REFERENCES "public"."harnesses"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_reminders" ADD CONSTRAINT "assistant_reminders_request_harness_fk" FOREIGN KEY ("request_id","harness_id") REFERENCES "public"."assistant_requests"("id","harness_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_reminders" ADD CONSTRAINT "assistant_reminders_effect_harness_fk" FOREIGN KEY ("effect_id","harness_id") REFERENCES "public"."assistant_effects"("id","harness_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_reminders_effect_once" ON "assistant_reminders" USING btree ("effect_id");--> statement-breakpoint
CREATE INDEX "assistant_reminders_due" ON "assistant_reminders" USING btree ("status","due_at","id");--> statement-breakpoint
CREATE INDEX "assistant_reminders_harness" ON "assistant_reminders" USING btree ("harness_id","status","due_at");--> statement-breakpoint
ALTER TABLE "harness_events" ADD CONSTRAINT "harness_events_name_known" CHECK ("harness_events"."name" IN ('item_created', 'item_claimed', 'item_released', 'item_reordered', 'lease_renewed', 'lease_expired', 'branch_abandoned', 'branch_adopted', 'stage_advanced', 'loop_edge_taken', 'premise_held', 'risk_derived', 'label_removed', 'run_started', 'run_step_recorded', 'run_failed', 'run_hibernated', 'run_resumed', 'run_stopped', 'run_completed', 'run_prompted', 'submitted_to_gate', 'checks_passed', 'checks_failed', 'gate_approved', 'gate_rejected', 'gate_taken_over', 'gate_overridden', 'gate_refused_to_agent', 'ship_refused', 'connector_succeeded', 'connector_refused', 'delegation_granted', 'delegation_revoked', 'delegation_lapsed', 'delegation_required', 'stage_edit_refused', 'stage_edited', 'stage_removed', 'workflow_draft_opened', 'workflow_draft_saved', 'workflow_draft_taken_over', 'workflow_draft_discarded', 'workflow_published', 'template_activated', 'harness_paused', 'harness_resumed', 'hosted_builder_set', 'learning_attached', 'nothing_learned', 'comment_recorded', 'zulip_topic_linked', 'breaker_holding', 'breaker_pausing', 'breaker_open', 'persona_activation_failed', 'persona_activated', 'measurement_recorded', 'handed_to_person', 'review_verdict_recorded', 'shadow_verdict', 'shadow_lifted', 'shadow_turned_on', 'freeze_changed', 'finding_refuted', 'delegated_merge', 'delegated_exit_claimed', 'fix_claimed', 'fix_claim_set', 'title_set', 'epic_enqueued', 'done_when_missing', 'silence_alarm', 'template_changed', 'assistant_customised', 'assistant_request_recorded', 'assistant_turn_started', 'assistant_turn_refused', 'assistant_turn_finished', 'assistant_effect_started', 'assistant_effect_done', 'assistant_effect_failed', 'assistant_reminder_set', 'assistant_reminder_cancelled', 'assistant_reminder_fired', 'assistant_reminder_undelivered'));