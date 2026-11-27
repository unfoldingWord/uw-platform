CREATE TABLE "assistant_bindings" (
	"harness_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"address" text NOT NULL,
	"via" text NOT NULL,
	"bound_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_bindings_pk" PRIMARY KEY("harness_id","channel"),
	CONSTRAINT "assistant_bindings_channel_known" CHECK ("assistant_bindings"."channel" IN ('zulip_dm', 'email')),
	CONSTRAINT "assistant_bindings_via_known" CHECK ("assistant_bindings"."via" IN ('email_match', 'pairing_code')),
	CONSTRAINT "assistant_bindings_address_length" CHECK (char_length("assistant_bindings"."address") BETWEEN 1 AND 254),
	CONSTRAINT "assistant_bindings_zulip_address" CHECK ("assistant_bindings"."channel" <> 'zulip_dm' OR "assistant_bindings"."address" ~ '^zulip:[1-9][0-9]{0,14}$')
);
--> statement-breakpoint
CREATE TABLE "assistant_pairing_codes" (
	"harness_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"code_digest" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_pairing_codes_pk" PRIMARY KEY("harness_id","channel"),
	CONSTRAINT "assistant_pairing_codes_channel_known" CHECK ("assistant_pairing_codes"."channel" IN ('zulip_dm', 'email')),
	CONSTRAINT "assistant_pairing_codes_digest_shape" CHECK ("assistant_pairing_codes"."code_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "assistant_pairing_codes_attempts_bounded" CHECK ("assistant_pairing_codes"."attempts" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE TABLE "assistant_zulip_bots" (
	"harness_id" uuid PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"bot_user_id" bigint NOT NULL,
	"bot_email" text NOT NULL,
	"full_name" text NOT NULL,
	"key_cipher" text NOT NULL,
	"key_ciphertext" text NOT NULL,
	"key_nonce" text NOT NULL,
	"key_wrapped" text NOT NULL,
	"key_id" text NOT NULL,
	"webhook_token_digest" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_zulip_bots_status_known" CHECK ("assistant_zulip_bots"."status" IN ('active', 'deactivated')),
	CONSTRAINT "assistant_zulip_bots_token_digest_shape" CHECK ("assistant_zulip_bots"."webhook_token_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "assistant_zulip_bots_user_positive" CHECK ("assistant_zulip_bots"."bot_user_id" > 0),
	CONSTRAINT "assistant_zulip_bots_email_length" CHECK (char_length("assistant_zulip_bots"."bot_email") BETWEEN 3 AND 254),
	CONSTRAINT "assistant_zulip_bots_full_name_length" CHECK (char_length("assistant_zulip_bots"."full_name") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "assistant_zulip_sends" (
	"effect_id" uuid PRIMARY KEY NOT NULL,
	"harness_id" uuid NOT NULL,
	"status" text NOT NULL,
	"zulip_message_id" bigint,
	"claimed_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "assistant_zulip_sends_status_known" CHECK ("assistant_zulip_sends"."status" IN ('sending', 'sent')),
	CONSTRAINT "assistant_zulip_sends_sent_has_message" CHECK (("assistant_zulip_sends"."status" = 'sent') = ("assistant_zulip_sends"."zulip_message_id" IS NOT NULL AND "assistant_zulip_sends"."sent_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "harness_events" DROP CONSTRAINT "harness_events_name_known";--> statement-breakpoint
ALTER TABLE "webhook_deliveries" DROP CONSTRAINT "webhook_deliveries_source_known";--> statement-breakpoint
ALTER TABLE "assistant_bindings" ADD CONSTRAINT "assistant_bindings_personal_harness_fk" FOREIGN KEY ("harness_id","person_id") REFERENCES "public"."harnesses"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_pairing_codes" ADD CONSTRAINT "assistant_pairing_codes_personal_harness_fk" FOREIGN KEY ("harness_id","person_id") REFERENCES "public"."harnesses"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_zulip_bots" ADD CONSTRAINT "assistant_zulip_bots_personal_harness_fk" FOREIGN KEY ("harness_id","person_id") REFERENCES "public"."harnesses"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_zulip_sends" ADD CONSTRAINT "assistant_zulip_sends_harness_id_harnesses_id_fk" FOREIGN KEY ("harness_id") REFERENCES "public"."harnesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_bindings_address_once" ON "assistant_bindings" USING btree ("channel","address");--> statement-breakpoint
CREATE INDEX "assistant_bindings_person" ON "assistant_bindings" USING btree ("person_id","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_zulip_bots_user_once" ON "assistant_zulip_bots" USING btree ("bot_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_zulip_bots_email_once" ON "assistant_zulip_bots" USING btree ("bot_email");--> statement-breakpoint
CREATE INDEX "assistant_zulip_bots_person" ON "assistant_zulip_bots" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "harness_events" ADD CONSTRAINT "harness_events_name_known" CHECK ("harness_events"."name" IN ('item_created', 'item_claimed', 'item_released', 'item_reordered', 'lease_renewed', 'lease_expired', 'branch_abandoned', 'branch_adopted', 'stage_advanced', 'loop_edge_taken', 'premise_held', 'risk_derived', 'label_removed', 'run_started', 'run_step_recorded', 'run_failed', 'run_hibernated', 'run_resumed', 'run_stopped', 'run_completed', 'run_prompted', 'submitted_to_gate', 'checks_passed', 'checks_failed', 'gate_approved', 'gate_rejected', 'gate_taken_over', 'gate_overridden', 'gate_refused_to_agent', 'ship_refused', 'connector_succeeded', 'connector_refused', 'delegation_granted', 'delegation_revoked', 'delegation_lapsed', 'delegation_required', 'stage_edit_refused', 'stage_edited', 'stage_removed', 'workflow_draft_opened', 'workflow_draft_saved', 'workflow_draft_taken_over', 'workflow_draft_discarded', 'workflow_published', 'template_activated', 'harness_paused', 'harness_resumed', 'hosted_builder_set', 'learning_attached', 'nothing_learned', 'comment_recorded', 'zulip_topic_linked', 'breaker_holding', 'breaker_pausing', 'breaker_open', 'persona_activation_failed', 'persona_activated', 'measurement_recorded', 'handed_to_person', 'review_verdict_recorded', 'shadow_verdict', 'shadow_lifted', 'shadow_turned_on', 'freeze_changed', 'finding_refuted', 'delegated_merge', 'delegated_exit_claimed', 'fix_claimed', 'fix_claim_set', 'title_set', 'epic_enqueued', 'done_when_missing', 'silence_alarm', 'template_changed', 'assistant_customised', 'assistant_request_recorded', 'assistant_turn_started', 'assistant_turn_refused', 'assistant_turn_finished', 'assistant_effect_started', 'assistant_effect_done', 'assistant_effect_failed', 'assistant_reminder_set', 'assistant_reminder_cancelled', 'assistant_reminder_fired', 'assistant_reminder_undelivered', 'assistant_pairing_started', 'assistant_paired', 'assistant_pairing_refused'));--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_source_known" CHECK ("webhook_deliveries"."source" IN ('github', 'zulip', 'zulip-assistant'));