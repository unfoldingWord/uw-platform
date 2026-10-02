ALTER TABLE "harnesses" ADD COLUMN "repository" text;--> statement-breakpoint
CREATE UNIQUE INDEX "harnesses_repository_once" ON "harnesses" USING btree (lower("repository")) WHERE "harnesses"."repository" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "harnesses" ADD CONSTRAINT "harnesses_repository_form" CHECK ("harnesses"."repository" ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$');