CREATE FUNCTION grant_audit_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'grant_audit is append-only' USING ERRCODE = 'P0001';
END
$$;
--> statement-breakpoint
CREATE TRIGGER grant_audit_no_update_or_delete BEFORE UPDATE OR DELETE ON grant_audit FOR EACH ROW EXECUTE FUNCTION grant_audit_refuse_change();
--> statement-breakpoint
CREATE TRIGGER grant_audit_no_truncate BEFORE TRUNCATE ON grant_audit FOR EACH STATEMENT EXECUTE FUNCTION grant_audit_refuse_change();
