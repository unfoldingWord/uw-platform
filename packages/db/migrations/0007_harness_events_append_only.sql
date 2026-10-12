CREATE FUNCTION harness_events_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'harness_events is append-only' USING ERRCODE = 'P0001';
END
$$;
--> statement-breakpoint
CREATE TRIGGER harness_events_no_update_or_delete BEFORE UPDATE OR DELETE ON harness_events FOR EACH ROW EXECUTE FUNCTION harness_events_refuse_change();
--> statement-breakpoint
CREATE TRIGGER harness_events_no_truncate BEFORE TRUNCATE ON harness_events FOR EACH STATEMENT EXECUTE FUNCTION harness_events_refuse_change();
--> statement-breakpoint
CREATE FUNCTION harness_events_assign_position() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('harness_events:' || NEW.harness_id::text, 0));
  NEW.position := coalesce((SELECT max(position) FROM harness_events WHERE harness_id = NEW.harness_id), 0) + 1;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER harness_events_position BEFORE INSERT ON harness_events FOR EACH ROW EXECUTE FUNCTION harness_events_assign_position();
--> statement-breakpoint
DO $$ BEGIN CREATE ROLE uw_app NOLOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO uw_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO uw_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON harness_events, gate_decisions, grant_audit FROM PUBLIC, uw_app;
