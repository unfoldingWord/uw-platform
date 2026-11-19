CREATE TABLE "routines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"service_token_id" uuid NOT NULL,
	"delegation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"access_token_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"paused_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"trace_id" uuid NOT NULL,
	CONSTRAINT "routines_name_length" CHECK (char_length("routines"."name") BETWEEN 1 AND 60),
	CONSTRAINT "routines_access_token_id_length" CHECK (char_length("routines"."access_token_id") BETWEEN 1 AND 100)
);
--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_service_token_id_service_tokens_id_fk" FOREIGN KEY ("service_token_id") REFERENCES "public"."service_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_delegation_id_delegations_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."delegations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "routines_one_per_service_token" ON "routines" USING btree ("service_token_id");--> statement-breakpoint
CREATE UNIQUE INDEX "routines_one_live_per_delegation" ON "routines" USING btree ("delegation_id") WHERE "routines"."revoked_at" IS NULL;