ALTER TABLE "gh_repos" DROP CONSTRAINT "gh_repos_full_name_form";--> statement-breakpoint
ALTER TABLE "harnesses" ADD COLUMN "repository" text;--> statement-breakpoint
CREATE UNIQUE INDEX "harnesses_repository_once" ON "harnesses" USING btree (lower("repository")) WHERE "harnesses"."repository" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "harnesses" ADD CONSTRAINT "harnesses_repository_form" CHECK ("harnesses"."repository" ~ '^(?!-)(?![A-Za-z0-9-]*-/)[A-Za-z0-9-]{1,39}/(?!\.\.?$)[A-Za-z0-9._-]{1,100}$');--> statement-breakpoint
ALTER TABLE "gh_repos" ADD CONSTRAINT "gh_repos_full_name_form" CHECK ("gh_repos"."full_name" ~ '^(?!-)(?![A-Za-z0-9-]*-/)[A-Za-z0-9-]{1,39}/(?!\.\.?$)[A-Za-z0-9._-]{1,100}$');