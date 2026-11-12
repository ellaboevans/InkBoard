-- Invariant: every private poem is readable with *some* password.
--   * author in per_poem mode -> the poem has its own password_hash
--   * author in shared mode   -> the author has a shared_password_hash
--     (guaranteed by CHECK editors_shared_mode_requires_password)
-- A CHECK can't look at another table, so two triggers enforce it, raising
-- check_violation like the CHECK constraint they replace.

CREATE FUNCTION poems_require_password() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mode password_mode;
BEGIN
  IF NEW.visibility = 'private' AND NEW.password_hash IS NULL THEN
    -- FOR SHARE: a concurrent mode switch on this editor waits for us (and
    -- we for it), so the two checks below can't both pass on stale data.
    SELECT password_mode INTO mode FROM editors WHERE id = NEW.editor_id FOR SHARE;
    IF mode IS DISTINCT FROM 'shared' THEN
      RAISE EXCEPTION 'private poem % has no password', NEW.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'poems_private_requires_password';
    END IF;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER poems_require_password
AFTER INSERT OR UPDATE OF visibility, password_hash, editor_id ON poems
FOR EACH ROW EXECUTE FUNCTION poems_require_password();
--> statement-breakpoint
CREATE FUNCTION editors_per_poem_requires_poem_passwords() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.password_mode = 'per_poem' AND EXISTS (
    SELECT 1 FROM poems
    WHERE editor_id = NEW.id AND visibility = 'private' AND password_hash IS NULL
  ) THEN
    RAISE EXCEPTION 'editor % has private poems without a password', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'poems_private_requires_password';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER editors_per_poem_requires_poem_passwords
AFTER UPDATE OF password_mode ON editors
FOR EACH ROW EXECUTE FUNCTION editors_per_poem_requires_poem_passwords();
