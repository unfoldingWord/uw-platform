CREATE TABLE "credential_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position" bigint GENERATED ALWAYS AS IDENTITY (sequence name "credential_access_log_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"credential_id" uuid NOT NULL,
	"version_id" uuid,
	"jd_area" text NOT NULL,
	"action" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"actor" text NOT NULL,
	"person_id" uuid,
	"harness_id" uuid,
	"connector_key" text,
	"run_id" uuid,
	"trace_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "credential_access_log_area_is_jd" CHECK ("credential_access_log"."jd_area" ~ '^([0-9])0-\1[9]$'),
	CONSTRAINT "credential_access_log_action_known" CHECK ("credential_access_log"."action" IN ('create', 'rotate', 'revoke', 'bind', 'use', 'reveal')),
	CONSTRAINT "credential_access_log_outcome_known" CHECK ("credential_access_log"."outcome" IN ('done', 'refused')),
	CONSTRAINT "credential_access_log_reason_matches" CHECK (("credential_access_log"."outcome" = 'done' AND "credential_access_log"."reason" IS NULL) OR ("credential_access_log"."outcome" = 'refused' AND "credential_access_log"."reason" IS NOT NULL AND "credential_access_log"."reason" IN ('not_permitted', 'credential_revoked', 'credential_expired', 'key_rejected', 'key_service_refused', 'key_service_unavailable', 'ciphertext_rejected', 'envelope_malformed'))),
	CONSTRAINT "credential_access_log_actor_is_identity" CHECK ("credential_access_log"."actor" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$')
);
--> statement-breakpoint
CREATE TABLE "credential_bindings" (
	"credential_id" uuid NOT NULL,
	"harness_id" uuid NOT NULL,
	"connector_key" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "credential_bindings_once" PRIMARY KEY("credential_id","harness_id","connector_key"),
	CONSTRAINT "credential_bindings_connector_known" CHECK ("credential_bindings"."connector_key" IN ('merge', 'deploy', 'publish', 'send', 'post'))
);
--> statement-breakpoint
CREATE TABLE "credential_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credential_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "credential_grants_capability_known" CHECK ("credential_grants"."capability" IN ('reveal')),
	CONSTRAINT "credential_grants_expires_after_grant" CHECK ("credential_grants"."expires_at" > "credential_grants"."granted_at")
);
--> statement-breakpoint
CREATE TABLE "credential_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"credential_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"cipher" text NOT NULL,
	"ciphertext" text NOT NULL,
	"nonce" text NOT NULL,
	"wrapped_key" text NOT NULL,
	"key_id" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "credential_versions_once" UNIQUE("credential_id","version"),
	CONSTRAINT "credential_versions_version_positive" CHECK ("credential_versions"."version" >= 1),
	CONSTRAINT "credential_versions_cipher_known" CHECK ("credential_versions"."cipher" IN ('aes-256-gcm')),
	CONSTRAINT "credential_versions_nonce_length" CHECK (length("credential_versions"."nonce") = 16 AND "credential_versions"."nonce" ~ '^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'),
	CONSTRAINT "credential_versions_sealed" CHECK (length("credential_versions"."ciphertext") > 0 AND "credential_versions"."ciphertext" ~ '^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' AND length("credential_versions"."wrapped_key") > 0 AND "credential_versions"."wrapped_key" ~ '^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' AND length("credential_versions"."key_id") > 0)
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"jd_area" text NOT NULL,
	"jd_ref" text,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"rotate_by" date,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "credentials_name_per_area" UNIQUE("jd_area","name"),
	CONSTRAINT "credentials_area_is_jd" CHECK ("credentials"."jd_area" ~ '^([0-9])0-\1[9]$'),
	CONSTRAINT "credentials_ref_inside_area" CHECK ("credentials"."jd_ref" IS NULL OR ("credentials"."jd_ref" ~ '^[0-9]{2}(\.[0-9]{2})?$' AND left("credentials"."jd_ref", 1) = left("credentials"."jd_area", 1))),
	CONSTRAINT "credentials_kind_known" CHECK ("credentials"."kind" IN ('api_key', 'oauth_refresh', 'password', 'ssh_key', 'certificate')),
	CONSTRAINT "credentials_name_trimmed" CHECK ("credentials"."name" = btrim("credentials"."name") AND length("credentials"."name") BETWEEN 1 AND 120)
);
--> statement-breakpoint
ALTER TABLE "credential_access_log" ADD CONSTRAINT "credential_access_log_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_access_log" ADD CONSTRAINT "credential_access_log_version_id_credential_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."credential_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_access_log" ADD CONSTRAINT "credential_access_log_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_bindings" ADD CONSTRAINT "credential_bindings_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_bindings" ADD CONSTRAINT "credential_bindings_harness_id_harnesses_id_fk" FOREIGN KEY ("harness_id") REFERENCES "public"."harnesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_bindings" ADD CONSTRAINT "credential_bindings_created_by_people_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_grants" ADD CONSTRAINT "credential_grants_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_grants" ADD CONSTRAINT "credential_grants_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_grants" ADD CONSTRAINT "credential_grants_granted_by_people_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_versions" ADD CONSTRAINT "credential_versions_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_versions" ADD CONSTRAINT "credential_versions_created_by_people_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_created_by_people_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credential_access_log_credential" ON "credential_access_log" USING btree ("credential_id","position");--> statement-breakpoint
CREATE INDEX "credential_grants_credential" ON "credential_grants" USING btree ("credential_id","person_id");