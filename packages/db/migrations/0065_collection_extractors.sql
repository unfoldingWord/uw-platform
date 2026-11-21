CREATE FUNCTION uw_ymd(value text) RETURNS date
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT CASE WHEN value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN make_date(substr(value, 1, 4)::int, substr(value, 6, 2)::int, substr(value, 9, 2)::int) END $$;--> statement-breakpoint
CREATE FUNCTION uw_prop_text(frontmatter jsonb, key text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT CASE WHEN jsonb_typeof(frontmatter -> key) = 'string' THEN frontmatter ->> key END $$;--> statement-breakpoint
CREATE FUNCTION uw_prop_number(frontmatter jsonb, key text) RETURNS numeric
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT CASE WHEN jsonb_typeof(frontmatter -> key) = 'number' THEN (frontmatter ->> key)::numeric END $$;--> statement-breakpoint
CREATE FUNCTION uw_prop_bool(frontmatter jsonb, key text) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT CASE WHEN jsonb_typeof(frontmatter -> key) = 'boolean' THEN (frontmatter ->> key)::boolean END $$;--> statement-breakpoint
CREATE FUNCTION uw_prop_date(frontmatter jsonb, key text) RETURNS date
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT public.uw_ymd(CASE WHEN jsonb_typeof(frontmatter -> key) = 'string' THEN frontmatter ->> key END) $$;--> statement-breakpoint
CREATE FUNCTION uw_prop_range_start(frontmatter jsonb, key text) RETURNS date
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT public.uw_ymd(CASE WHEN jsonb_typeof(frontmatter -> key) = 'object' THEN frontmatter -> key ->> 'start' END) $$;--> statement-breakpoint
CREATE FUNCTION uw_prop_range_end(frontmatter jsonb, key text) RETURNS date
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT public.uw_ymd(CASE WHEN jsonb_typeof(frontmatter -> key) = 'object' THEN frontmatter -> key ->> 'end' END) $$;--> statement-breakpoint
CREATE FUNCTION uw_prop_list(frontmatter jsonb, key text) RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT CASE jsonb_typeof(frontmatter -> key) WHEN 'array' THEN ARRAY(SELECT jsonb_array_elements_text(frontmatter -> key)) WHEN 'string' THEN ARRAY[frontmatter ->> key] ELSE '{}'::text[] END $$;--> statement-breakpoint
CREATE FUNCTION uw_instant_date(at timestamptz) RETURNS date
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT (at AT TIME ZONE 'UTC')::date $$;
