CREATE FUNCTION credential_versions_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'credential_versions is append-only' USING ERRCODE = 'P0001';
END
$$;
--> statement-breakpoint
CREATE TRIGGER credential_versions_no_update_or_delete BEFORE UPDATE OR DELETE ON credential_versions FOR EACH ROW EXECUTE FUNCTION credential_versions_refuse_change();
--> statement-breakpoint
CREATE TRIGGER credential_versions_no_truncate BEFORE TRUNCATE ON credential_versions FOR EACH STATEMENT EXECUTE FUNCTION credential_versions_refuse_change();
--> statement-breakpoint
CREATE FUNCTION credential_access_log_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.at < now() - interval '7 years' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'credential_access_log is append-only and kept seven years' USING ERRCODE = 'P0001';
END
$$;
--> statement-breakpoint
CREATE TRIGGER credential_access_log_no_update_or_delete BEFORE UPDATE OR DELETE ON credential_access_log FOR EACH ROW EXECUTE FUNCTION credential_access_log_refuse_change();
--> statement-breakpoint
CREATE TRIGGER credential_access_log_no_truncate BEFORE TRUNCATE ON credential_access_log FOR EACH STATEMENT EXECUTE FUNCTION credential_access_log_refuse_change();
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON credential_versions FROM PUBLIC, uw_app;
--> statement-breakpoint
REVOKE UPDATE, TRUNCATE ON credential_access_log FROM PUBLIC, uw_app;
