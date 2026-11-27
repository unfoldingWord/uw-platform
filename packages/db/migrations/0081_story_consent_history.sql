CREATE TABLE "story_consent_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_before" date,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "story_consent_history_kind_known" CHECK ("story_consent_history"."kind" IN ('granted', 'withdrawn')),
	CONSTRAINT "story_consent_history_withdrawal_open" CHECK ("story_consent_history"."kind" <> 'withdrawn' OR "story_consent_history"."ends_before" IS NULL),
	CONSTRAINT "story_consent_history_recorded_by_identity" CHECK ("story_consent_history"."recorded_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$')
);
--> statement-breakpoint
ALTER TABLE "pdf_exports" ADD COLUMN "channel" text DEFAULT 'platform' NOT NULL;--> statement-breakpoint
ALTER TABLE "pdf_exports" ADD COLUMN "stories" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "story_consent_history" ADD CONSTRAINT "story_consent_history_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_consent_history_page" ON "story_consent_history" USING btree ("page_id","recorded_at");--> statement-breakpoint
ALTER TABLE "pdf_exports" ADD CONSTRAINT "pdf_exports_channel_known" CHECK ("pdf_exports"."channel" IN ('platform', 'private_circulation', 'newsletter', 'public'));--> statement-breakpoint
ALTER TABLE "pdf_exports" ADD CONSTRAINT "pdf_exports_stories_listed" CHECK (jsonb_typeof("pdf_exports"."stories") = 'array');--> statement-breakpoint
CREATE FUNCTION story_consent_history_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'story_consent_history is append-only' USING ERRCODE = 'P0001';
END
$$;
--> statement-breakpoint
CREATE TRIGGER story_consent_history_no_update_or_delete BEFORE UPDATE OR DELETE ON story_consent_history FOR EACH ROW EXECUTE FUNCTION story_consent_history_refuse_change();
--> statement-breakpoint
CREATE TRIGGER story_consent_history_no_truncate BEFORE TRUNCATE ON story_consent_history FOR EACH STATEMENT EXECUTE FUNCTION story_consent_history_refuse_change();
--> statement-breakpoint
INSERT INTO story_consent_history (page_id, kind, starts_on, ends_before, recorded_by, recorded_at)
SELECT page_id, 'granted', consented_on, consent_expires, updated_by, updated_at - interval '1 microsecond'
FROM story_consents;
--> statement-breakpoint
INSERT INTO story_consent_history (page_id, kind, starts_on, ends_before, recorded_by, recorded_at)
SELECT page_id, 'withdrawn', (withdrawn_at AT TIME ZONE 'UTC')::date, NULL, updated_by, withdrawn_at
FROM story_consents
WHERE withdrawn_at IS NOT NULL;
--> statement-breakpoint
UPDATE pdf_exports e
SET channel = u.channel,
  stories = u.stories
FROM (
  SELECT reference, min(channel) AS channel,
    jsonb_agg(jsonb_build_object('pageId', page_id, 'version', version) ORDER BY page_id) AS stories
  FROM story_uses
  WHERE kind IN ('pdf_page', 'pdf_binder')
  GROUP BY reference
) u
WHERE u.reference = e.id::text;
--> statement-breakpoint
UPDATE pdf_exports
SET channel = request -> 'target' ->> 'channel'
WHERE kind = 'binder' AND stories = '[]'::jsonb
  AND request -> 'target' ->> 'channel' IN ('platform', 'private_circulation', 'newsletter', 'public');
