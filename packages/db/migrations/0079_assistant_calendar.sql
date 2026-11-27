CREATE TABLE "assistant_calendar_holds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"harness_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"released_effect_id" uuid,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_calendar_holds_status_known" CHECK ("assistant_calendar_holds"."status" IN ('held', 'released')),
	CONSTRAINT "assistant_calendar_holds_released_when_done" CHECK (("assistant_calendar_holds"."status" = 'released') = ("assistant_calendar_holds"."released_at" IS NOT NULL AND "assistant_calendar_holds"."released_effect_id" IS NOT NULL)),
	CONSTRAINT "assistant_calendar_holds_at_most_a_day" CHECK ("assistant_calendar_holds"."ends_at" > "assistant_calendar_holds"."starts_at" AND "assistant_calendar_holds"."ends_at" - "assistant_calendar_holds"."starts_at" <= interval '24 hours'),
	CONSTRAINT "assistant_calendar_holds_title_length" CHECK (char_length("assistant_calendar_holds"."title") BETWEEN 1 AND 200),
	CONSTRAINT "assistant_calendar_holds_event_id_shape" CHECK ("assistant_calendar_holds"."event_id" ~ '^[0-9a-v]{5,}$' AND char_length("assistant_calendar_holds"."event_id") <= 1024)
);
--> statement-breakpoint
CREATE TABLE "assistant_mailboxes" (
	"harness_id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"address" text NOT NULL,
	"google_user_id" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_mailboxes_address_shape" CHECK ("assistant_mailboxes"."address" ~ '^[a-z0-9][a-z0-9.-]{0,63}@[a-z0-9][a-z0-9.-]{0,188}$'),
	CONSTRAINT "assistant_mailboxes_status_known" CHECK ("assistant_mailboxes"."status" IN ('active', 'suspended', 'deleted'))
);
--> statement-breakpoint
ALTER TABLE "harness_events" DROP CONSTRAINT "harness_events_name_known";--> statement-breakpoint
ALTER TABLE "assistant_calendar_holds" ADD CONSTRAINT "assistant_calendar_holds_personal_harness_fk" FOREIGN KEY ("harness_id","person_id") REFERENCES "public"."harnesses"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_calendar_holds" ADD CONSTRAINT "assistant_calendar_holds_effect_harness_fk" FOREIGN KEY ("id","harness_id") REFERENCES "public"."assistant_effects"("id","harness_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_calendar_holds" ADD CONSTRAINT "assistant_calendar_holds_released_effect_fk" FOREIGN KEY ("released_effect_id","harness_id") REFERENCES "public"."assistant_effects"("id","harness_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_mailboxes" ADD CONSTRAINT "assistant_mailboxes_personal_harness_fk" FOREIGN KEY ("harness_id","person_id") REFERENCES "public"."harnesses"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_calendar_holds_event_once" ON "assistant_calendar_holds" USING btree ("harness_id","event_id");--> statement-breakpoint
CREATE INDEX "assistant_calendar_holds_harness" ON "assistant_calendar_holds" USING btree ("harness_id","status","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_mailboxes_address_once" ON "assistant_mailboxes" USING btree ("address");--> statement-breakpoint
CREATE INDEX "assistant_mailboxes_person" ON "assistant_mailboxes" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "harness_events" ADD CONSTRAINT "harness_events_name_known" CHECK ("harness_events"."name" IN ('item_created', 'item_claimed', 'item_released', 'item_reordered', 'lease_renewed', 'lease_expired', 'branch_abandoned', 'branch_adopted', 'stage_advanced', 'loop_edge_taken', 'premise_held', 'risk_derived', 'label_removed', 'run_started', 'run_step_recorded', 'run_failed', 'run_hibernated', 'run_resumed', 'run_stopped', 'run_completed', 'run_prompted', 'submitted_to_gate', 'checks_passed', 'checks_failed', 'gate_approved', 'gate_rejected', 'gate_taken_over', 'gate_overridden', 'gate_refused_to_agent', 'ship_refused', 'connector_succeeded', 'connector_refused', 'delegation_granted', 'delegation_revoked', 'delegation_lapsed', 'delegation_required', 'stage_edit_refused', 'stage_edited', 'stage_removed', 'workflow_draft_opened', 'workflow_draft_saved', 'workflow_draft_taken_over', 'workflow_draft_discarded', 'workflow_published', 'template_activated', 'harness_paused', 'harness_resumed', 'hosted_builder_set', 'learning_attached', 'nothing_learned', 'comment_recorded', 'zulip_topic_linked', 'breaker_holding', 'breaker_pausing', 'breaker_open', 'persona_activation_failed', 'persona_activated', 'measurement_recorded', 'handed_to_person', 'review_verdict_recorded', 'shadow_verdict', 'shadow_lifted', 'shadow_turned_on', 'freeze_changed', 'finding_refuted', 'delegated_merge', 'delegated_exit_claimed', 'fix_claimed', 'fix_claim_set', 'title_set', 'epic_enqueued', 'done_when_missing', 'silence_alarm', 'template_changed', 'assistant_customised', 'assistant_request_recorded', 'assistant_turn_started', 'assistant_turn_refused', 'assistant_turn_finished', 'assistant_effect_started', 'assistant_effect_done', 'assistant_effect_failed', 'assistant_reminder_set', 'assistant_reminder_cancelled', 'assistant_reminder_fired', 'assistant_reminder_undelivered', 'assistant_pairing_started', 'assistant_paired', 'assistant_pairing_refused', 'assistant_budget_set', 'assistant_hold_placed', 'assistant_hold_released'));