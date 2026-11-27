CREATE FUNCTION page_review_sets_refuse_settled_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'a decided review set is kept as it was decided'
      USING ERRCODE = '23514', CONSTRAINT = 'page_review_sets_settled', TABLE = 'page_review_sets';
  END IF;
  IF NEW.page_id IS DISTINCT FROM OLD.page_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.request_id IS DISTINCT FROM OLD.request_id THEN
    RAISE EXCEPTION 'a review set keeps its page, its author and its request'
      USING ERRCODE = '23514', CONSTRAINT = 'page_review_sets_settled', TABLE = 'page_review_sets';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER page_review_sets_settled BEFORE UPDATE OR DELETE ON page_review_sets FOR EACH ROW EXECUTE FUNCTION page_review_sets_refuse_settled_change();
--> statement-breakpoint
CREATE FUNCTION page_suggested_changes_refuse_settled_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  held uuid;
  settled boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.review_set_id IS DISTINCT FROM OLD.review_set_id THEN
    RAISE EXCEPTION 'a suggested change stays in its review set'
      USING ERRCODE = '23514', CONSTRAINT = 'page_suggested_changes_settled', TABLE = 'page_suggested_changes';
  END IF;
  held := CASE WHEN TG_OP = 'DELETE' THEN OLD.review_set_id ELSE NEW.review_set_id END;
  SELECT status <> 'pending' INTO settled FROM page_review_sets WHERE id = held;
  IF settled THEN
    RAISE EXCEPTION 'the changes of a decided review set are kept as they were decided'
      USING ERRCODE = '23514', CONSTRAINT = 'page_suggested_changes_settled', TABLE = 'page_suggested_changes';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER page_suggested_changes_settled BEFORE INSERT OR UPDATE OR DELETE ON page_suggested_changes FOR EACH ROW EXECUTE FUNCTION page_suggested_changes_refuse_settled_change();
--> statement-breakpoint
CREATE FUNCTION page_review_decisions_refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'a review decision is kept as it was recorded'
    USING ERRCODE = '23514', CONSTRAINT = 'page_review_decisions_append_only', TABLE = 'page_review_decisions';
END
$$;
--> statement-breakpoint
CREATE TRIGGER page_review_decisions_append_only BEFORE UPDATE OR DELETE ON page_review_decisions FOR EACH ROW EXECUTE FUNCTION page_review_decisions_refuse_change();
