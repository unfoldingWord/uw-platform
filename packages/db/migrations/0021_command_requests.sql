CREATE TABLE "command_requests" (
	"actor" text NOT NULL,
	"request_id" uuid NOT NULL,
	"command" text NOT NULL,
	"harness_id" uuid NOT NULL,
	"outcome" jsonb,
	"trace_id" uuid NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "command_requests_pkey" PRIMARY KEY("actor","request_id"),
	CONSTRAINT "command_requests_command_known" CHECK ("command_requests"."command" IN ('kickstart', 'enqueue', 'import', 'reorder', 'claim', 'release', 'submit_to_gate', 'approve', 'reject', 'take_over', 'override', 'prompt_run', 'stop_run', 'pause', 'resume', 'tweak_package', 'schedule_regular_tweak', 'revoke_delegation', 'recover_connectors', 'activate_template', 'create_stage', 'update_stage', 'reorder_stages', 'remove_stage')),
	CONSTRAINT "command_requests_actor_is_identity" CHECK ("command_requests"."actor" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$'),
	CONSTRAINT "command_requests_settled_with_outcome" CHECK (("command_requests"."outcome" IS NULL) = ("command_requests"."settled_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "harness_events" ADD COLUMN "request_id" uuid;