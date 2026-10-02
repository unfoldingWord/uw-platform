CREATE FUNCTION harness_stages_refuse_issue_instructions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.instructions_page_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM pages WHERE id = NEW.instructions_page_id AND type = 'issue') THEN
    RAISE EXCEPTION 'a stage instructions page is never an issue page'
      USING ERRCODE = '23514', CONSTRAINT = 'harness_stages_instructions_not_issue', TABLE = 'harness_stages';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER harness_stages_instructions_not_issue BEFORE INSERT OR UPDATE OF instructions_page_id ON harness_stages FOR EACH ROW EXECUTE FUNCTION harness_stages_refuse_issue_instructions();
