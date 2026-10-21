ALTER TABLE "gate_decisions" DROP CONSTRAINT "gate_decisions_lent_binding_fk";--> statement-breakpoint
DROP INDEX "delegations_lent_binding";--> statement-breakpoint
ALTER TABLE "delegations" ADD COLUMN "grantor" text GENERATED ALWAYS AS ('human:' || "person_id"::text) STORED;--> statement-breakpoint
CREATE UNIQUE INDEX "delegations_lent_binding" ON "delegations" USING btree ("id","harness_id","persona","capability","grantor");--> statement-breakpoint
ALTER TABLE "gate_decisions" ADD CONSTRAINT "gate_decisions_lent_binding_fk" FOREIGN KEY ("delegation_id","harness_id","agent_actor","delegated_capability","actor") REFERENCES "public"."delegations"("id","harness_id","persona","capability","grantor") ON DELETE no action ON UPDATE no action;
