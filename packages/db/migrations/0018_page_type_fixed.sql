CREATE FUNCTION pages_refuse_type_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type IS DISTINCT FROM OLD.type THEN
    RAISE EXCEPTION 'a page keeps the type it was created with'
      USING ERRCODE = '23514', CONSTRAINT = 'pages_type_fixed', TABLE = 'pages';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER pages_type_fixed BEFORE UPDATE OF type ON pages FOR EACH ROW EXECUTE FUNCTION pages_refuse_type_change();
