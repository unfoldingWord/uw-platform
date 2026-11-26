CREATE FUNCTION page_suggestion_sets_refuse_settled_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'a decided suggestion set is kept as it was decided'
      USING ERRCODE = '23514', CONSTRAINT = 'page_suggestion_sets_settled', TABLE = 'page_suggestion_sets';
  END IF;
  IF NEW.page_id IS DISTINCT FROM OLD.page_id OR NEW.proposed_by IS DISTINCT FROM OLD.proposed_by THEN
    RAISE EXCEPTION 'a suggestion set keeps its page and its proposer'
      USING ERRCODE = '23514', CONSTRAINT = 'page_suggestion_sets_settled', TABLE = 'page_suggestion_sets';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER page_suggestion_sets_settled BEFORE UPDATE OR DELETE ON page_suggestion_sets FOR EACH ROW EXECUTE FUNCTION page_suggestion_sets_refuse_settled_change();
