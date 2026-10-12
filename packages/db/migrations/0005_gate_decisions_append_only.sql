CREATE FUNCTION gate_decisions_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'gate_decisions is append-only' USING ERRCODE = 'P0001';
END
$$;
--> statement-breakpoint
CREATE TRIGGER gate_decisions_no_update_or_delete BEFORE UPDATE OR DELETE ON gate_decisions FOR EACH ROW EXECUTE FUNCTION gate_decisions_refuse_change();
--> statement-breakpoint
CREATE TRIGGER gate_decisions_no_truncate BEFORE TRUNCATE ON gate_decisions FOR EACH STATEMENT EXECUTE FUNCTION gate_decisions_refuse_change();
