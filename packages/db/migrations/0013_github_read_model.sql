CREATE TABLE "gh_check_runs" (
	"github_id" bigint PRIMARY KEY NOT NULL,
	"repo_id" bigint NOT NULL,
	"head_sha" text NOT NULL,
	"name" text NOT NULL,
	"app_slug" text,
	"status" text NOT NULL,
	"conclusion" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"fresh_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gh_check_runs_head_sha_form" CHECK ("gh_check_runs"."head_sha" ~ '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'),
	CONSTRAINT "gh_check_runs_status_known" CHECK ("gh_check_runs"."status" IN ('queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending')),
	CONSTRAINT "gh_check_runs_conclusion_known" CHECK ("gh_check_runs"."conclusion" IN ('success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale'))
);
--> statement-breakpoint
CREATE TABLE "gh_issues" (
	"github_id" bigint PRIMARY KEY NOT NULL,
	"repo_id" bigint NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"milestone_id" bigint,
	"github_updated_at" timestamp with time zone NOT NULL,
	"xref_claimed_at" timestamp with time zone,
	"xref_comment_id" bigint,
	"fresh_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gh_issues_repo_number" UNIQUE("repo_id","number"),
	CONSTRAINT "gh_issues_state_known" CHECK ("gh_issues"."state" IN ('open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "gh_milestones" (
	"github_id" bigint PRIMARY KEY NOT NULL,
	"repo_id" bigint NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"due_on" timestamp with time zone,
	"github_updated_at" timestamp with time zone NOT NULL,
	"fresh_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gh_milestones_repo_number" UNIQUE("repo_id","number"),
	CONSTRAINT "gh_milestones_state_known" CHECK ("gh_milestones"."state" IN ('open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "gh_prs" (
	"github_id" bigint PRIMARY KEY NOT NULL,
	"repo_id" bigint NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"draft" boolean NOT NULL,
	"head_sha" text NOT NULL,
	"head_ref" text NOT NULL,
	"base_ref" text NOT NULL,
	"milestone_id" bigint,
	"declaration" jsonb,
	"declaration_problem" text,
	"files" jsonb,
	"files_head" text,
	"files_problem" text,
	"github_updated_at" timestamp with time zone NOT NULL,
	"fresh_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gh_prs_repo_number" UNIQUE("repo_id","number"),
	CONSTRAINT "gh_prs_state_known" CHECK ("gh_prs"."state" IN ('open', 'closed', 'merged')),
	CONSTRAINT "gh_prs_head_sha_form" CHECK ("gh_prs"."head_sha" ~ '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'),
	CONSTRAINT "gh_prs_files_head_form" CHECK ("gh_prs"."files_head" ~ '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'),
	CONSTRAINT "gh_prs_one_declaration_outcome" CHECK ("gh_prs"."declaration" IS NULL OR "gh_prs"."declaration_problem" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "gh_repos" (
	"github_id" bigint PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text NOT NULL,
	"private" boolean NOT NULL,
	"swept_through" timestamp with time zone,
	"last_sweep" jsonb,
	"fresh_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gh_repos_full_name_form" CHECK ("gh_repos"."full_name" ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')
);
--> statement-breakpoint
CREATE TABLE "gh_reviews" (
	"github_id" bigint PRIMARY KEY NOT NULL,
	"repo_id" bigint NOT NULL,
	"pr_id" bigint NOT NULL,
	"reviewer_login" text NOT NULL,
	"commit_id" text NOT NULL,
	"state" text NOT NULL,
	"provider" text,
	"submitted_at" timestamp with time zone,
	"fresh_at" timestamp with time zone NOT NULL,
	CONSTRAINT "gh_reviews_commit_id_form" CHECK ("gh_reviews"."commit_id" ~ '^(?:[0-9a-f]{40}|[0-9a-f]{64})$'),
	CONSTRAINT "gh_reviews_state_known" CHECK ("gh_reviews"."state" IN ('approved', 'changes_requested', 'commented', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "gh_check_runs" ADD CONSTRAINT "gh_check_runs_repo_id_gh_repos_github_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."gh_repos"("github_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gh_issues" ADD CONSTRAINT "gh_issues_repo_id_gh_repos_github_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."gh_repos"("github_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gh_milestones" ADD CONSTRAINT "gh_milestones_repo_id_gh_repos_github_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."gh_repos"("github_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gh_prs" ADD CONSTRAINT "gh_prs_repo_id_gh_repos_github_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."gh_repos"("github_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gh_reviews" ADD CONSTRAINT "gh_reviews_repo_id_gh_repos_github_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."gh_repos"("github_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gh_reviews" ADD CONSTRAINT "gh_reviews_pr_id_gh_prs_github_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."gh_prs"("github_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gh_check_runs_head" ON "gh_check_runs" USING btree ("repo_id","head_sha");--> statement-breakpoint
CREATE UNIQUE INDEX "gh_repos_full_name_once" ON "gh_repos" USING btree (lower("full_name"));--> statement-breakpoint
CREATE INDEX "gh_reviews_pr" ON "gh_reviews" USING btree ("pr_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_received_at" ON "webhook_deliveries" USING btree ("received_at");