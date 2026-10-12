ALTER TABLE "gh_prs" ADD COLUMN "base_sha" text NOT NULL;--> statement-breakpoint
ALTER TABLE "gh_prs" ADD COLUMN "files_base" text;--> statement-breakpoint
ALTER TABLE "gh_prs" ADD CONSTRAINT "gh_prs_base_sha_form" CHECK ("gh_prs"."base_sha" ~ '^(?:[0-9a-f]{40}|[0-9a-f]{64})$');--> statement-breakpoint
ALTER TABLE "gh_prs" ADD CONSTRAINT "gh_prs_files_base_form" CHECK ("gh_prs"."files_base" ~ '^(?:[0-9a-f]{40}|[0-9a-f]{64})$');