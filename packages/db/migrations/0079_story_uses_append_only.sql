CREATE FUNCTION story_uses_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'story_uses is append-only' USING ERRCODE = 'P0001';
END
$$;
--> statement-breakpoint
CREATE TRIGGER story_uses_no_update_or_delete BEFORE UPDATE OR DELETE ON story_uses FOR EACH ROW EXECUTE FUNCTION story_uses_refuse_change();
--> statement-breakpoint
CREATE TRIGGER story_uses_no_truncate BEFORE TRUNCATE ON story_uses FOR EACH STATEMENT EXECUTE FUNCTION story_uses_refuse_change();
