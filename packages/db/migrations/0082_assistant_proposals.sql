CREATE TABLE "assistant_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"harness_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"digest" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "assistant_proposals_id_harness" UNIQUE("id","harness_id"),
	CONSTRAINT "assistant_proposals_kind_known" CHECK ("assistant_proposals"."kind" IN ('email', 'invite', 'page_append')),
	CONSTRAINT "assistant_proposals_status_known" CHECK ("assistant_proposals"."status" IN ('pending', 'accepted', 'declined', 'expired')),
	CONSTRAINT "assistant_proposals_decided_by_human" CHECK ("assistant_proposals"."decided_by" IS NULL OR "assistant_proposals"."decided_by" ~ '^human:[A-Za-z0-9][A-Za-z0-9_-]*$'),
	CONSTRAINT "assistant_proposals_decided_together" CHECK (("assistant_proposals"."status" IN ('accepted', 'declined')) = ("assistant_proposals"."decided_by" IS NOT NULL) AND ("assistant_proposals"."decided_by" IS NULL) = ("assistant_proposals"."decided_at" IS NULL)),
	CONSTRAINT "assistant_proposals_expires_in_a_week" CHECK ("assistant_proposals"."expires_at" = "assistant_proposals"."created_at" + interval '7 days'),
	CONSTRAINT "assistant_proposals_digest_shape" CHECK ("assistant_proposals"."digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "assistant_proposals_payload_object" CHECK (jsonb_typeof("assistant_proposals"."payload") = 'object'),
	CONSTRAINT "assistant_proposals_redacted_empty" CHECK ("assistant_proposals"."redacted_at" IS NULL OR ("assistant_proposals"."payload" = '{}'::jsonb AND "assistant_proposals"."status" <> 'pending'))
);
--> statement-breakpoint
ALTER TABLE "harness_events" DROP CONSTRAINT "harness_events_name_known";--> statement-breakpoint
ALTER TABLE "assistant_effects" DROP CONSTRAINT "assistant_effects_direct_only";--> statement-breakpoint
ALTER TABLE "assistant_effects" ADD COLUMN "proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "assistant_proposals" ADD CONSTRAINT "assistant_proposals_personal_harness_fk" FOREIGN KEY ("harness_id","person_id") REFERENCES "public"."harnesses"("id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_proposals" ADD CONSTRAINT "assistant_proposals_request_harness_fk" FOREIGN KEY ("request_id","harness_id") REFERENCES "public"."assistant_requests"("id","harness_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_proposals_harness" ON "assistant_proposals" USING btree ("harness_id","status","created_at");--> statement-breakpoint
CREATE INDEX "assistant_proposals_expiring" ON "assistant_proposals" USING btree ("expires_at","id") WHERE "assistant_proposals"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_effects_proposal_once" ON "assistant_effects" USING btree ("proposal_id");--> statement-breakpoint
ALTER TABLE "harness_events" ADD CONSTRAINT "harness_events_name_known" CHECK ("harness_events"."name" IN ('item_created', 'item_claimed', 'item_released', 'item_reordered', 'lease_renewed', 'lease_expired', 'branch_abandoned', 'branch_adopted', 'stage_advanced', 'loop_edge_taken', 'premise_held', 'risk_derived', 'label_removed', 'run_started', 'run_step_recorded', 'run_failed', 'run_hibernated', 'run_resumed', 'run_stopped', 'run_completed', 'run_prompted', 'submitted_to_gate', 'checks_passed', 'checks_failed', 'gate_approved', 'gate_rejected', 'gate_taken_over', 'gate_overridden', 'gate_refused_to_agent', 'ship_refused', 'connector_succeeded', 'connector_refused', 'delegation_granted', 'delegation_revoked', 'delegation_lapsed', 'delegation_required', 'stage_edit_refused', 'stage_edited', 'stage_removed', 'workflow_draft_opened', 'workflow_draft_saved', 'workflow_draft_taken_over', 'workflow_draft_discarded', 'workflow_published', 'template_activated', 'harness_paused', 'harness_resumed', 'hosted_builder_set', 'learning_attached', 'nothing_learned', 'comment_recorded', 'zulip_topic_linked', 'breaker_holding', 'breaker_pausing', 'breaker_open', 'persona_activation_failed', 'persona_activated', 'measurement_recorded', 'handed_to_person', 'review_verdict_recorded', 'shadow_verdict', 'shadow_lifted', 'shadow_turned_on', 'freeze_changed', 'finding_refuted', 'delegated_merge', 'delegated_exit_claimed', 'fix_claimed', 'fix_claim_set', 'title_set', 'epic_enqueued', 'done_when_missing', 'silence_alarm', 'template_changed', 'assistant_customised', 'assistant_request_recorded', 'assistant_turn_started', 'assistant_turn_refused', 'assistant_turn_finished', 'assistant_effect_started', 'assistant_effect_done', 'assistant_effect_failed', 'assistant_reminder_set', 'assistant_reminder_cancelled', 'assistant_reminder_fired', 'assistant_reminder_undelivered', 'assistant_pairing_started', 'assistant_paired', 'assistant_pairing_refused', 'assistant_budget_set', 'assistant_hold_placed', 'assistant_hold_released', 'assistant_enabled', 'assistant_disabled', 'assistant_provisioned', 'assistant_provisioning_failed', 'assistant_deleted', 'assistant_effect_undone', 'assistant_history_redacted', 'assistant_mail_declined', 'assistant_proposal_drafted', 'assistant_proposal_decided', 'assistant_proposal_expired'));--> statement-breakpoint
ALTER TABLE "assistant_effects" ADD CONSTRAINT "assistant_effects_direct_or_decided" CHECK (("assistant_effects"."kind" IN ('reply_to_requester', 'reminder_set', 'reminder_cancelled', 'calendar_hold_added', 'calendar_hold_changed', 'calendar_hold_removed') AND "assistant_effects"."proposal_id" IS NULL) OR ("assistant_effects"."kind" IN ('email_sent', 'invite_sent', 'page_appended') AND "assistant_effects"."proposal_id" IS NOT NULL));