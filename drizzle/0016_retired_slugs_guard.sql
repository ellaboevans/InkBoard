-- Retired author slugs (Phase 17) are never given to another editor, so old
-- links never point at someone else's poems. setPenName (profile.ts) already
-- skips them; this is the database's guarantee, also against a deletion that
-- commits between its read and its write. It raises unique_violation, which
-- setPenName's retry loop handles like a slug taken by another editor.
CREATE FUNCTION editors_slug_not_retired() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.slug IS NOT NULL AND EXISTS (SELECT 1 FROM retired_slugs WHERE slug = NEW.slug) THEN
    RAISE EXCEPTION 'author slug % is retired', NEW.slug
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'editors_slug_not_retired';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER editors_slug_not_retired
BEFORE INSERT OR UPDATE OF slug ON editors
FOR EACH ROW EXECUTE FUNCTION editors_slug_not_retired();
