CREATE TABLE "collection_card_order" (
	"view_id" uuid NOT NULL,
	"row_id" uuid NOT NULL,
	"position" text NOT NULL,
	CONSTRAINT "collection_card_order_pkey" PRIMARY KEY("view_id","row_id"),
	CONSTRAINT "collection_card_order_position_form" CHECK ("collection_card_order"."position" ~ '^[0-9A-Za-z]+$')
);
--> statement-breakpoint
CREATE TABLE "collection_properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"classification" text NOT NULL,
	"position" integer NOT NULL,
	"definition" jsonb NOT NULL,
	CONSTRAINT "collection_properties_key_form" CHECK ("collection_properties"."key" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "collection_properties_type_known" CHECK ("collection_properties"."type" IN ('title', 'text', 'number', 'select', 'multi_select', 'status', 'person', 'date', 'date_range', 'url', 'email', 'phone', 'checkbox', 'files', 'relation', 'rollup', 'computed', 'read_through', 'created_time', 'created_by', 'edited_time', 'edited_by', 'completed_time')),
	CONSTRAINT "collection_properties_classification_known" CHECK ("collection_properties"."classification" IN ('internal', 'restricted', 'sensitive'))
);
--> statement-breakpoint
CREATE TABLE "collection_requests" (
	"actor" text NOT NULL,
	"request_id" uuid NOT NULL,
	"command" text NOT NULL,
	"outcome" jsonb NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_requests_pkey" PRIMARY KEY("actor","request_id"),
	CONSTRAINT "collection_requests_actor_is_identity" CHECK ("collection_requests"."actor" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$'),
	CONSTRAINT "collection_requests_command_known" CHECK ("collection_requests"."command" IN ('create_collection', 'update_collection', 'add_property', 'update_property', 'change_property_type', 'remove_property', 'create_row', 'set_property', 'move_card', 'save_view', 'delete_view', 'save_template')),
	CONSTRAINT "collection_requests_outcome_bounded" CHECK (octet_length("collection_requests"."outcome"::text) <= 16384)
);
--> statement-breakpoint
CREATE TABLE "collection_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"collection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"values" jsonb NOT NULL,
	"body_md" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "collection_templates_name_bounded" CHECK (length(btrim("collection_templates"."name")) BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE TABLE "collection_versions" (
	"collection_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"saved_by" text NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_versions_pkey" PRIMARY KEY("collection_id","version"),
	CONSTRAINT "collection_versions_saved_by_is_identity" CHECK ("collection_versions"."saved_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$')
);
--> statement-breakpoint
CREATE TABLE "collection_view_filters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"view_id" uuid NOT NULL,
	"parent_id" uuid,
	"kind" text NOT NULL,
	"conjunction" text,
	"property_id" uuid,
	"operator" text,
	"value" jsonb,
	"position" integer NOT NULL,
	CONSTRAINT "collection_view_filters_kind_known" CHECK ("collection_view_filters"."kind" IN ('group', 'condition')),
	CONSTRAINT "collection_view_filters_shape" CHECK (("collection_view_filters"."kind" = 'group' AND "collection_view_filters"."conjunction" IN ('and', 'or') AND "collection_view_filters"."property_id" IS NULL AND "collection_view_filters"."operator" IS NULL) OR ("collection_view_filters"."kind" = 'condition' AND "collection_view_filters"."conjunction" IS NULL AND "collection_view_filters"."property_id" IS NOT NULL AND "collection_view_filters"."parent_id" IS NOT NULL AND "collection_view_filters"."operator" IN ('is', 'is_not', 'contains', 'not_contains', 'starts_with', 'is_any_of', 'group_is', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'before', 'after', 'on_or_before', 'on_or_after', 'within', 'is_empty', 'is_not_empty')))
);
--> statement-breakpoint
CREATE TABLE "collection_view_groups" (
	"view_id" uuid NOT NULL,
	"value" text NOT NULL,
	"visible" boolean NOT NULL,
	"position" integer NOT NULL,
	"wip_limit" integer,
	CONSTRAINT "collection_view_groups_pkey" PRIMARY KEY("view_id","value"),
	CONSTRAINT "collection_view_groups_wip_bounded" CHECK ("collection_view_groups"."wip_limit" IS NULL OR "collection_view_groups"."wip_limit" BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE "collection_view_properties" (
	"view_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"visible" boolean NOT NULL,
	"width" integer,
	"position" integer NOT NULL,
	CONSTRAINT "collection_view_properties_pkey" PRIMARY KEY("view_id","property_id"),
	CONSTRAINT "collection_view_properties_width_bounded" CHECK ("collection_view_properties"."width" IS NULL OR "collection_view_properties"."width" BETWEEN 60 AND 800)
);
--> statement-breakpoint
CREATE TABLE "collection_view_sorts" (
	"view_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "collection_view_sorts_pkey" PRIMARY KEY("view_id","property_id"),
	CONSTRAINT "collection_view_sorts_direction_known" CHECK ("collection_view_sorts"."direction" IN ('asc', 'desc'))
);
--> statement-breakpoint
CREATE TABLE "collection_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"collection_id" uuid NOT NULL,
	"owner_id" uuid,
	"name" text NOT NULL,
	"layout" text NOT NULL,
	"position" integer NOT NULL,
	"group_property_id" uuid,
	"group_by" text NOT NULL,
	"hide_empty_groups" boolean NOT NULL,
	"manual_order" boolean NOT NULL,
	"date_property_id" uuid,
	"chart_kind" text,
	"chart_sum_property_id" uuid,
	"cover" boolean NOT NULL,
	"default_template_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_views_layout_known" CHECK ("collection_views"."layout" IN ('table', 'board', 'list', 'gallery', 'calendar', 'chart')),
	CONSTRAINT "collection_views_group_by_known" CHECK ("collection_views"."group_by" IN ('value', 'status_group')),
	CONSTRAINT "collection_views_chart_kind_known" CHECK ("collection_views"."chart_kind" IS NULL OR "collection_views"."chart_kind" IN ('bar', 'donut')),
	CONSTRAINT "collection_views_name_bounded" CHECK (length(btrim("collection_views"."name")) BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"jd_area" text NOT NULL,
	"row_source" text NOT NULL,
	"page_type" text,
	"description" text NOT NULL,
	"locked" boolean NOT NULL,
	"version" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_key_form" CHECK ("collections"."key" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "collections_area_form" CHECK ("collections"."jd_area" ~ '^([0-9])0-\1[9]$'),
	CONSTRAINT "collections_row_source_known" CHECK ("collections"."row_source" IN ('pages', 'tasks', 'people')),
	CONSTRAINT "collections_page_type_with_pages" CHECK (("collections"."row_source" = 'pages') = ("collections"."page_type" IS NOT NULL)),
	CONSTRAINT "collections_version_positive" CHECK ("collections"."version" >= 1),
	CONSTRAINT "collections_created_by_is_identity" CHECK ("collections"."created_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$')
);
--> statement-breakpoint
CREATE TABLE "directory_entries" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"role" text,
	"team" text,
	"employment" text,
	"ring" text,
	"joined" date,
	"url" text,
	"portfolios" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"page_id" uuid,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "directory_entries_role_bounded" CHECK ("directory_entries"."role" IS NULL OR length(btrim("directory_entries"."role")) BETWEEN 1 AND 200),
	CONSTRAINT "directory_entries_url_bounded" CHECK ("directory_entries"."url" IS NULL OR length(btrim("directory_entries"."url")) BETWEEN 1 AND 2000),
	CONSTRAINT "directory_entries_team_form" CHECK ("directory_entries"."team" IS NULL OR "directory_entries"."team" ~ '^[a-z0-9][a-z0-9_-]*$'),
	CONSTRAINT "directory_entries_employment_form" CHECK ("directory_entries"."employment" IS NULL OR "directory_entries"."employment" ~ '^[a-z0-9][a-z0-9_-]*$'),
	CONSTRAINT "directory_entries_ring_form" CHECK ("directory_entries"."ring" IS NULL OR "directory_entries"."ring" ~ '^[a-z0-9][a-z0-9_-]*$'),
	CONSTRAINT "directory_entries_updated_by_is_identity" CHECK ("directory_entries"."updated_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$')
);
--> statement-breakpoint
CREATE TABLE "directory_private" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"phone" text,
	"mailing_address" text,
	"compliance_status" text,
	"compliance_due" date,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "directory_private_phone_bounded" CHECK ("directory_private"."phone" IS NULL OR length(btrim("directory_private"."phone")) BETWEEN 1 AND 40),
	CONSTRAINT "directory_private_address_bounded" CHECK ("directory_private"."mailing_address" IS NULL OR length(btrim("directory_private"."mailing_address")) BETWEEN 1 AND 1000),
	CONSTRAINT "directory_private_compliance_form" CHECK ("directory_private"."compliance_status" IS NULL OR "directory_private"."compliance_status" ~ '^[a-z0-9][a-z0-9_-]*$'),
	CONSTRAINT "directory_private_updated_by_is_identity" CHECK ("directory_private"."updated_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$')
);
--> statement-breakpoint
ALTER TABLE "page_links" DROP CONSTRAINT "page_links_rel_known";--> statement-breakpoint
ALTER TABLE "page_versions" DROP CONSTRAINT "page_versions_type_known";--> statement-breakpoint
ALTER TABLE "pages" DROP CONSTRAINT "pages_type_known";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_status_known";--> statement-breakpoint
ALTER TABLE "page_links" ADD COLUMN "position" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "collection_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "assignees" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "priority" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "files" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "related" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "collection_card_order" ADD CONSTRAINT "collection_card_order_view_id_collection_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."collection_views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_properties" ADD CONSTRAINT "collection_properties_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_templates" ADD CONSTRAINT "collection_templates_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_versions" ADD CONSTRAINT "collection_versions_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_view_filters" ADD CONSTRAINT "collection_view_filters_view_id_collection_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."collection_views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_view_filters" ADD CONSTRAINT "collection_view_filters_property_id_collection_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."collection_properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_view_filters" ADD CONSTRAINT "collection_view_filters_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."collection_view_filters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_view_groups" ADD CONSTRAINT "collection_view_groups_view_id_collection_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."collection_views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_view_properties" ADD CONSTRAINT "collection_view_properties_view_id_collection_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."collection_views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_view_properties" ADD CONSTRAINT "collection_view_properties_property_id_collection_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."collection_properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_view_sorts" ADD CONSTRAINT "collection_view_sorts_view_id_collection_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."collection_views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_view_sorts" ADD CONSTRAINT "collection_view_sorts_property_id_collection_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."collection_properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_views" ADD CONSTRAINT "collection_views_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_views" ADD CONSTRAINT "collection_views_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_views" ADD CONSTRAINT "collection_views_group_property_id_collection_properties_id_fk" FOREIGN KEY ("group_property_id") REFERENCES "public"."collection_properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_views" ADD CONSTRAINT "collection_views_date_property_id_collection_properties_id_fk" FOREIGN KEY ("date_property_id") REFERENCES "public"."collection_properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_views" ADD CONSTRAINT "collection_views_chart_sum_property_id_collection_properties_id_fk" FOREIGN KEY ("chart_sum_property_id") REFERENCES "public"."collection_properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_views" ADD CONSTRAINT "collection_views_default_template_id_collection_templates_id_fk" FOREIGN KEY ("default_template_id") REFERENCES "public"."collection_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_entries" ADD CONSTRAINT "directory_entries_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_entries" ADD CONSTRAINT "directory_entries_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_private" ADD CONSTRAINT "directory_private_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_card_order_position" ON "collection_card_order" USING btree ("view_id","position" COLLATE "C");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_properties_key" ON "collection_properties" USING btree ("collection_id","key");--> statement-breakpoint
CREATE INDEX "collection_templates_collection" ON "collection_templates" USING btree ("collection_id","position");--> statement-breakpoint
CREATE INDEX "collection_view_filters_view" ON "collection_view_filters" USING btree ("view_id");--> statement-breakpoint
CREATE INDEX "collection_views_collection" ON "collection_views" USING btree ("collection_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_key" ON "collections" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_page_type" ON "collections" USING btree ("page_type") WHERE "collections"."page_type" IS NOT NULL AND "collections"."page_type" <> 'entry';--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_links_rel_from" ON "page_links" USING btree ("rel","from_page");--> statement-breakpoint
CREATE INDEX "page_links_rel_to" ON "page_links" USING btree ("rel","to_page");--> statement-breakpoint
CREATE INDEX "pages_collection" ON "pages" USING btree ("collection_id","jd_area");--> statement-breakpoint
CREATE INDEX "pages_prop_phase" ON "pages" USING btree ("collection_id",uw_prop_text("frontmatter", 'phase')) WHERE "pages"."collection_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pages_prop_status" ON "pages" USING btree ("collection_id",uw_prop_text("frontmatter", 'status')) WHERE "pages"."collection_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pages_prop_duration" ON "pages" USING btree ("collection_id",uw_prop_range_start("frontmatter", 'duration')) WHERE "pages"."collection_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pages_prop_lead" ON "pages" USING gin (uw_prop_list("frontmatter", 'lead')) WHERE "pages"."collection_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "tasks_assignees" ON "tasks" USING gin ("assignees");--> statement-breakpoint
CREATE INDEX "tasks_page" ON "tasks" USING btree ("page_id");--> statement-breakpoint
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_position_form" CHECK ("page_links"."position" IS NULL OR "page_links"."position" ~ '^[0-9A-Za-z]+$');--> statement-breakpoint
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_rel_known" CHECK ("page_links"."rel" IN ('links', 'embeds', 'unresolved') OR "page_links"."rel" ~ '^[a-z][a-z0-9_]*[.][a-z][a-z0-9_]*$');--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_type_known" CHECK ("page_versions"."type" IN ('skill', 'learning', 'persona', 'product', 'system_goal', 'product_strategy', 'data_sources', 'issue', 'platform', 'knowledge', 'entry', 'portfolio', 'program', 'project', 'okr'));--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_type_known" CHECK ("pages"."type" IN ('skill', 'learning', 'persona', 'product', 'system_goal', 'product_strategy', 'data_sources', 'issue', 'platform', 'knowledge', 'entry', 'portfolio', 'program', 'project', 'okr'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_priority_known" CHECK ("tasks"."priority" IN ('urgent', 'high', 'normal', 'low'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_description_bounded" CHECK (length("tasks"."description") <= 10000);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_bounded" CHECK (length("tasks"."source") <= 200);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_updated_by_is_identity" CHECK ("tasks"."updated_by" IS NULL OR "tasks"."updated_by" ~ '^(?:human:[A-Za-z0-9][A-Za-z0-9_-]*|agent:[a-z0-9][a-z0-9_-]*|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31}|agent:[A-Za-z0-9][A-Za-z0-9_-]*/[a-z0-9][a-z0-9-]{0,31} as [a-z0-9][a-z0-9_-]* via delegation:[A-Za-z0-9][A-Za-z0-9_-]*)$');--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_known" CHECK ("tasks"."status" IN ('suggested', 'open', 'done', 'dismissed', 'backlog', 'recurring', 'in_progress', 'review'));