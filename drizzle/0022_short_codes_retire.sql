-- Short codes (Phase 21 round 3) are never given to another poem, so a code
-- printed on a picture can't come to point at someone else's poem.
-- 1. Deleting a short link (with its poem, or its editor's account, by
--    cascade) moves its code to retired_short_codes.
-- 2. A retired code can't be put on a short link: unique_violation, which
--    ensureShortCode (src/server/short-links.ts) retries with a new code, like
--    a code another poem already has.
CREATE FUNCTION short_links_retire_code() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO retired_short_codes (code) VALUES (OLD.code) ON CONFLICT DO NOTHING;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER short_links_retire_code
BEFORE DELETE ON short_links
FOR EACH ROW EXECUTE FUNCTION short_links_retire_code();
--> statement-breakpoint
CREATE FUNCTION short_links_code_not_retired() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM retired_short_codes WHERE code = NEW.code) THEN
    RAISE EXCEPTION 'short code % is retired', NEW.code
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'short_links_code_not_retired';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER short_links_code_not_retired
BEFORE INSERT OR UPDATE OF code ON short_links
FOR EACH ROW EXECUTE FUNCTION short_links_code_not_retired();
