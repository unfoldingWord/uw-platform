ALTER TABLE "page_versions" DROP CONSTRAINT "page_versions_type_known";--> statement-breakpoint
ALTER TABLE "pages" DROP CONSTRAINT "pages_type_known";--> statement-breakpoint
ALTER TABLE "harness_items" ADD COLUMN "issue_repo" text;--> statement-breakpoint
ALTER TABLE "harness_items" ADD COLUMN "issue_number" integer;--> statement-breakpoint
ALTER TABLE "harness_items" ADD COLUMN "issue_github_id" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "harness_items_issue_once" ON "harness_items" USING btree ("issue_github_id") WHERE "harness_items"."issue_github_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "harness_items" ADD CONSTRAINT "harness_items_issue_whole" CHECK (("harness_items"."issue_repo" IS NULL) = ("harness_items"."issue_number" IS NULL) AND ("harness_items"."issue_number" IS NULL) = ("harness_items"."issue_github_id" IS NULL));--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_type_known" CHECK ("page_versions"."type" IN ('skill', 'learning', 'persona', 'product', 'system_goal', 'product_strategy', 'data_sources', 'issue'));--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_type_known" CHECK ("pages"."type" IN ('skill', 'learning', 'persona', 'product', 'system_goal', 'product_strategy', 'data_sources', 'issue'));