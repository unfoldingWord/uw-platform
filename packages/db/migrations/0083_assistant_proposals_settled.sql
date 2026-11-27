CREATE FUNCTION assistant_proposals_refuse_settled_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a proposal is kept as it was drafted and decided'
      USING ERRCODE = '23514', CONSTRAINT = 'assistant_proposals_settled', TABLE = 'assistant_proposals';
  END IF;
  IF (NEW.id, NEW.harness_id, NEW.person_id, NEW.request_id, NEW.kind, NEW.created_at, NEW.expires_at)
     IS DISTINCT FROM (OLD.id, OLD.harness_id, OLD.person_id, OLD.request_id, OLD.kind, OLD.created_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'a proposal keeps its harness, person, request, kind and expiry'
      USING ERRCODE = '23514', CONSTRAINT = 'assistant_proposals_settled', TABLE = 'assistant_proposals';
  END IF;
  IF OLD.status <> 'pending' AND (NEW.status, NEW.decided_by, NEW.decided_at)
     IS DISTINCT FROM (OLD.status, OLD.decided_by, OLD.decided_at) THEN
    RAISE EXCEPTION 'a decided proposal is kept as it was decided'
      USING ERRCODE = '23514', CONSTRAINT = 'assistant_proposals_settled', TABLE = 'assistant_proposals';
  END IF;
  IF NEW.payload IS DISTINCT FROM OLD.payload AND NOT (OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'a proposal keeps the payload it was drafted with until it is redacted'
      USING ERRCODE = '23514', CONSTRAINT = 'assistant_proposals_settled', TABLE = 'assistant_proposals';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER assistant_proposals_settled BEFORE UPDATE OR DELETE ON assistant_proposals FOR EACH ROW EXECUTE FUNCTION assistant_proposals_refuse_settled_change();
--> statement-breakpoint
CREATE FUNCTION assistant_effects_refuse_undecided_proposal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  decided record;
BEGIN
  IF NEW.proposal_id IS NULL OR NEW.kind NOT IN ('email_sent', 'invite_sent', 'page_appended') THEN
    RETURN NEW;
  END IF;
  SELECT status, harness_id, kind INTO decided FROM assistant_proposals WHERE id = NEW.proposal_id;
  IF NOT FOUND OR decided.status <> 'accepted' OR decided.harness_id <> NEW.harness_id
     OR NEW.kind IS DISTINCT FROM (CASE decided.kind
       WHEN 'email' THEN 'email_sent'
       WHEN 'invite' THEN 'invite_sent'
       WHEN 'page_append' THEN 'page_appended'
     END) THEN
    RAISE EXCEPTION 'an assistant effect outside the direct set runs only for its accepted proposal'
      USING ERRCODE = '23514', CONSTRAINT = 'assistant_effects_decided_proposal', TABLE = 'assistant_effects';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER assistant_effects_decided_proposal BEFORE INSERT OR UPDATE OF proposal_id, kind ON assistant_effects FOR EACH ROW EXECUTE FUNCTION assistant_effects_refuse_undecided_proposal();
--> statement-breakpoint
CREATE FUNCTION assistant_proposals_set_digest() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.digest := encode(sha256(convert_to(NEW.payload::text, 'UTF8')), 'hex');
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER assistant_proposals_digest BEFORE INSERT OR UPDATE ON assistant_proposals FOR EACH ROW EXECUTE FUNCTION assistant_proposals_set_digest();
