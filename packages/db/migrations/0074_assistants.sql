CREATE TABLE "assistant_effects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"harness_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_effects_direct_only" CHECK ("assistant_effects"."kind" IN ('reply_to_requester', 'reminder_set', 'reminder_cancelled', 'calendar_hold_added', 'calendar_hold_changed', 'calendar_hold_removed')),
	CONSTRAINT "assistant_effects_payload_object" CHECK (jsonb_typeof("assistant_effects"."payload") = 'object'),
	CONSTRAINT "assistant_effects_idempotency_key_length" CHECK (char_length("assistant_effects"."idempotency_key") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "assistant_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"harness_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"external_id" text NOT NULL,
	"thread_key" text,
	"reply_address" text NOT NULL,
	"note" text NOT NULL,
	"untrusted_parts" jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_requests_id_harness" UNIQUE("id","harness_id"),
	CONSTRAINT "assistant_requests_channel_known" CHECK ("assistant_requests"."channel" IN ('zulip_dm', 'email')),
	CONSTRAINT "assistant_requests_untrusted_parts_bounded" CHECK (jsonb_typeof("assistant_requests"."untrusted_parts") = 'array' AND jsonb_array_length("assistant_requests"."untrusted_parts") <= 20),
	CONSTRAINT "assistant_requests_external_id_length" CHECK (char_length("assistant_requests"."external_id") BETWEEN 1 AND 200),
	CONSTRAINT "assistant_requests_thread_key_length" CHECK (char_length("assistant_requests"."thread_key") BETWEEN 1 AND 200),
	CONSTRAINT "assistant_requests_reply_address_length" CHECK (char_length("assistant_requests"."reply_address") BETWEEN 1 AND 254),
	CONSTRAINT "assistant_requests_note_length" CHECK (char_length("assistant_requests"."note") <= 20000)
);
--> statement-breakpoint
CREATE TABLE "assistant_settings" (
	"harness_id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"instructions_md" text NOT NULL,
	"timezone" text NOT NULL,
	"version" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_settings_version_positive" CHECK ("assistant_settings"."version" >= 1),
	CONSTRAINT "assistant_settings_display_name_length" CHECK (char_length("assistant_settings"."display_name") BETWEEN 1 AND 60),
	CONSTRAINT "assistant_settings_instructions_length" CHECK (char_length("assistant_settings"."instructions_md") <= 8000),
	CONSTRAINT "assistant_settings_timezone_length" CHECK (char_length("assistant_settings"."timezone") BETWEEN 1 AND 64)
);
--> statement-breakpoint
ALTER TABLE "delegations" DROP CONSTRAINT "delegations_capability_known";--> statement-breakpoint
ALTER TABLE "harness_events" DROP CONSTRAINT "harness_events_name_known";--> statement-breakpoint
ALTER TABLE "harnesses" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "harnesses" ADD CONSTRAINT "harnesses_id_person" UNIQUE("id","person_id");--> statement-breakpoint
ALTER TABLE "assistant_effects" ADD CONSTRAINT "assistant_effects_harness_id_harnesses_id_fk" FOREIGN KEY ("harness_id") REFERENCES "public"."harnesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_effects" ADD CONSTRAINT "assistant_effects_request_harness_fk" FOREIGN KEY ("request_id","harness_id") REFERENCES "public"."assistant_requests"("id","harness_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_requests" ADD CONSTRAINT "assistant_requests_harness_id_harnesses_id_fk" FOREIGN KEY ("harness_id") REFERENCES "public"."harnesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_requests" ADD CONSTRAINT "assistant_requests_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_requests" ADD CONSTRAINT "assistant_requests_personal_harness_fk" FOREIGN KEY ("harness_id","person_id") REFERENCES "public"."harnesses"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_personal_harness_fk" FOREIGN KEY ("harness_id","person_id") REFERENCES "public"."harnesses"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_effects_key_once" ON "assistant_effects" USING btree ("harness_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "assistant_effects_request" ON "assistant_effects" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_requests_external_once" ON "assistant_requests" USING btree ("channel","external_id");--> statement-breakpoint
CREATE INDEX "assistant_requests_thread" ON "assistant_requests" USING btree ("harness_id","channel","thread_key","recorded_at","id");--> statement-breakpoint
ALTER TABLE "harnesses" ADD CONSTRAINT "harnesses_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "harness_events_assistant_request" ON "harness_events" USING btree ("harness_id",("evidence" ->> 'requestId')) WHERE "harness_events"."name" IN ('assistant_request_recorded', 'assistant_turn_started', 'assistant_turn_refused', 'assistant_turn_finished', 'assistant_effect_started');--> statement-breakpoint
CREATE INDEX "harness_events_assistant_effect" ON "harness_events" USING btree ("harness_id",("evidence" ->> 'effectId')) WHERE "harness_events"."name" IN ('assistant_effect_started', 'assistant_effect_done', 'assistant_effect_failed');--> statement-breakpoint
CREATE INDEX "harness_events_assistant_spend" ON "harness_events" USING btree ("harness_id","at") WHERE "harness_events"."name" IN ('assistant_turn_finished');--> statement-breakpoint
CREATE INDEX "harness_events_assistant_open" ON "harness_events" USING btree ("harness_id","at") WHERE "harness_events"."name" IN ('assistant_turn_started');--> statement-breakpoint
CREATE UNIQUE INDEX "harnesses_one_assistant_per_person" ON "harnesses" USING btree ("person_id") WHERE "harnesses"."person_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_capability_known" CHECK ("delegations"."capability" IN ('none', 'iterate', 'build', 'review', 'merge', 'fix', 'assist'));--> statement-breakpoint
ALTER TABLE "harness_events" ADD CONSTRAINT "harness_events_name_known" CHECK ("harness_events"."name" IN ('item_created', 'item_claimed', 'item_released', 'item_reordered', 'lease_renewed', 'lease_expired', 'branch_abandoned', 'branch_adopted', 'stage_advanced', 'loop_edge_taken', 'premise_held', 'risk_derived', 'label_removed', 'run_started', 'run_step_recorded', 'run_failed', 'run_hibernated', 'run_resumed', 'run_stopped', 'run_completed', 'run_prompted', 'submitted_to_gate', 'checks_passed', 'checks_failed', 'gate_approved', 'gate_rejected', 'gate_taken_over', 'gate_overridden', 'gate_refused_to_agent', 'ship_refused', 'connector_succeeded', 'connector_refused', 'delegation_granted', 'delegation_revoked', 'delegation_lapsed', 'delegation_required', 'stage_edit_refused', 'stage_edited', 'stage_removed', 'workflow_draft_opened', 'workflow_draft_saved', 'workflow_draft_taken_over', 'workflow_draft_discarded', 'workflow_published', 'template_activated', 'harness_paused', 'harness_resumed', 'hosted_builder_set', 'learning_attached', 'nothing_learned', 'comment_recorded', 'zulip_topic_linked', 'breaker_holding', 'breaker_pausing', 'breaker_open', 'persona_activation_failed', 'persona_activated', 'measurement_recorded', 'handed_to_person', 'review_verdict_recorded', 'shadow_verdict', 'shadow_lifted', 'shadow_turned_on', 'freeze_changed', 'finding_refuted', 'delegated_merge', 'delegated_exit_claimed', 'fix_claimed', 'fix_claim_set', 'title_set', 'epic_enqueued', 'done_when_missing', 'silence_alarm', 'template_changed', 'assistant_customised', 'assistant_request_recorded', 'assistant_turn_started', 'assistant_turn_refused', 'assistant_turn_finished', 'assistant_effect_started', 'assistant_effect_done', 'assistant_effect_failed'));--> statement-breakpoint
ALTER TABLE "harnesses" ADD CONSTRAINT "harnesses_personal_template" CHECK (("harnesses"."template" IN ('assistant')) = ("harnesses"."person_id" IS NOT NULL));