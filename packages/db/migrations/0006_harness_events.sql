CREATE TABLE "harness_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"harness_id" uuid NOT NULL,
	"item_id" uuid,
	"position" bigint DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"actor" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"trace_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "harness_events_name_known" CHECK ("harness_events"."name" IN ('item_created', 'item_claimed', 'item_released', 'lease_renewed', 'lease_expired', 'branch_abandoned', 'branch_adopted', 'stage_advanced', 'loop_edge_taken', 'premise_held', 'risk_derived', 'label_removed', 'run_started', 'run_step_recorded', 'run_failed', 'run_hibernated', 'run_resumed', 'run_stopped', 'submitted_to_gate', 'checks_passed', 'checks_failed', 'gate_approved', 'gate_rejected', 'gate_taken_over', 'gate_overridden', 'gate_refused_to_agent', 'ship_refused', 'connector_succeeded', 'connector_refused', 'delegation_granted', 'delegation_revoked', 'delegation_lapsed', 'delegation_required', 'stage_edit_refused', 'template_activated', 'harness_paused', 'harness_resumed', 'learning_attached', 'nothing_learned', 'comment_recorded', 'breaker_holding', 'breaker_pausing', 'breaker_open', 'persona_activation_failed', 'persona_activated')),
	CONSTRAINT "harness_events_actor_is_identity" CHECK ("harness_events"."actor" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[A-Za-z0-9][A-Za-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[A-Za-z0-9][A-Za-z0-9_-]* as [A-Za-z0-9][A-Za-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$'),
	CONSTRAINT "harness_events_position_positive" CHECK ("harness_events"."position" >= 1)
);
--> statement-breakpoint
ALTER TABLE "harness_events" ADD CONSTRAINT "harness_events_harness_id_harnesses_id_fk" FOREIGN KEY ("harness_id") REFERENCES "public"."harnesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_events" ADD CONSTRAINT "harness_events_item_fk" FOREIGN KEY ("harness_id","item_id") REFERENCES "public"."harness_items"("harness_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "harness_events_position_per_harness" ON "harness_events" USING btree ("harness_id","position");--> statement-breakpoint
CREATE INDEX "harness_events_item" ON "harness_events" USING btree ("item_id","position");