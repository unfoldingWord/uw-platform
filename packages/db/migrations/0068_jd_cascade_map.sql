CREATE TABLE "cascade_placements" (
	"entity_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"cascade_page_id" uuid NOT NULL,
	"placed_by" text NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "cascade_placements_pk" PRIMARY KEY("entity_kind","entity_id"),
	CONSTRAINT "cascade_placements_kind_known" CHECK ("cascade_placements"."entity_kind" IN ('page', 'task', 'item')),
	CONSTRAINT "cascade_placements_placed_by_identity" CHECK ("cascade_placements"."placed_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$')
);
--> statement-breakpoint
CREATE TABLE "jd_cascade_map" (
	"id" uuid PRIMARY KEY NOT NULL,
	"jd_area" text NOT NULL,
	"cascade_page_id" uuid NOT NULL,
	"relation" text NOT NULL,
	"note" text,
	"declared_by" text NOT NULL,
	"declared_at" timestamp with time zone NOT NULL,
	CONSTRAINT "jd_cascade_map_area_form" CHECK ("jd_cascade_map"."jd_area" ~ '^([0-9])0-\1[9]$'),
	CONSTRAINT "jd_cascade_map_relation_known" CHECK ("jd_cascade_map"."relation" IN ('owns', 'supports', 'funds', 'reports_on')),
	CONSTRAINT "jd_cascade_map_declared_by_identity" CHECK ("jd_cascade_map"."declared_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$')
);
--> statement-breakpoint
CREATE TABLE "jd_cascade_map_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"action" text NOT NULL,
	"map_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"trace_id" uuid NOT NULL,
	CONSTRAINT "jd_cascade_map_audit_action_known" CHECK ("jd_cascade_map_audit"."action" IN ('declare', 'remove')),
	CONSTRAINT "jd_cascade_map_audit_actor_identity" CHECK ("jd_cascade_map_audit"."actor" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$')
);
--> statement-breakpoint
ALTER TABLE "cascade_placements" ADD CONSTRAINT "cascade_placements_cascade_page_id_pages_id_fk" FOREIGN KEY ("cascade_page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jd_cascade_map" ADD CONSTRAINT "jd_cascade_map_cascade_page_id_pages_id_fk" FOREIGN KEY ("cascade_page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cascade_placements_node" ON "cascade_placements" USING btree ("cascade_page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jd_cascade_map_one_relation" ON "jd_cascade_map" USING btree ("jd_area","cascade_page_id","relation");--> statement-breakpoint
CREATE INDEX "jd_cascade_map_node" ON "jd_cascade_map" USING btree ("cascade_page_id");--> statement-breakpoint
CREATE INDEX "jd_cascade_map_audit_map" ON "jd_cascade_map_audit" USING btree ("map_id");