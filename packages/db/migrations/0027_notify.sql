CREATE TABLE "push_cooldowns" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"rank" integer NOT NULL,
	CONSTRAINT "push_cooldowns_rank_known" CHECK ("push_cooldowns"."rank" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"endpoint" text PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_https" CHECK ("push_subscriptions"."endpoint" LIKE 'https://%')
);
--> statement-breakpoint
ALTER TABLE "harness_events" DROP CONSTRAINT "harness_events_name_known";--> statement-breakpoint
ALTER TABLE "webhook_deliveries" DROP CONSTRAINT "webhook_deliveries_source_known";--> statement-breakpoint
ALTER TABLE "push_cooldowns" ADD CONSTRAINT "push_cooldowns_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_subscriptions_person" ON "push_subscriptions" USING btree ("person_id","created_at");--> statement-breakpoint
ALTER TABLE "harness_events" ADD CONSTRAINT "harness_events_name_known" CHECK ("harness_events"."name" IN ('item_created', 'item_claimed', 'item_released', 'item_reordered', 'lease_renewed', 'lease_expired', 'branch_abandoned', 'branch_adopted', 'stage_advanced', 'loop_edge_taken', 'premise_held', 'risk_derived', 'label_removed', 'run_started', 'run_step_recorded', 'run_failed', 'run_hibernated', 'run_resumed', 'run_stopped', 'run_completed', 'run_prompted', 'submitted_to_gate', 'checks_passed', 'checks_failed', 'gate_approved', 'gate_rejected', 'gate_taken_over', 'gate_overridden', 'gate_refused_to_agent', 'ship_refused', 'connector_succeeded', 'connector_refused', 'delegation_granted', 'delegation_revoked', 'delegation_lapsed', 'delegation_required', 'stage_edit_refused', 'stage_edited', 'stage_removed', 'template_activated', 'harness_paused', 'harness_resumed', 'hosted_builder_set', 'learning_attached', 'nothing_learned', 'comment_recorded', 'zulip_topic_linked', 'breaker_holding', 'breaker_pausing', 'breaker_open', 'persona_activation_failed', 'persona_activated'));--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_source_known" CHECK ("webhook_deliveries"."source" IN ('github', 'zulip'));