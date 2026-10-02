ALTER TABLE "service_tokens" DROP CONSTRAINT "service_tokens_pkey";--> statement-breakpoint
ALTER TABLE "service_tokens" ADD COLUMN "id" uuid;--> statement-breakpoint
UPDATE "service_tokens" SET "id" = gen_random_uuid();--> statement-breakpoint
ALTER TABLE "service_tokens" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "service_tokens" ADD CONSTRAINT "service_tokens_pkey" PRIMARY KEY ("id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_tokens_one_live_client" ON "service_tokens" USING btree ("client_id") WHERE "service_tokens"."revoked_at" IS NULL;
