CREATE TABLE "person_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"action" text NOT NULL,
	"person_id" uuid NOT NULL,
	"before" text NOT NULL,
	"after" text NOT NULL,
	"trace_id" uuid NOT NULL,
	CONSTRAINT "person_audit_action_known" CHECK ("person_audit"."action" IN ('approve', 'decline')),
	CONSTRAINT "person_audit_actor_is_human" CHECK ("person_audit"."actor" ~ '^human:[A-Za-z0-9][A-Za-z0-9_-]*$'),
	CONSTRAINT "person_audit_before_known" CHECK ("person_audit"."before" IN ('active', 'pending', 'disabled')),
	CONSTRAINT "person_audit_after_known" CHECK ("person_audit"."after" IN ('active', 'pending', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "people" DROP CONSTRAINT "people_status_known";--> statement-breakpoint
ALTER TABLE "person_audit" ADD CONSTRAINT "person_audit_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_audit_person" ON "person_audit" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_status_known" CHECK ("people"."status" IN ('active', 'pending', 'disabled'));