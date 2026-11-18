-- Private novels (docs/PLAN.md, Phase 25): the poems' invariant from
-- 0002_password_mode_triggers.sql, extended to novels. Every private novel
-- is readable with *some* password:
--   * author in per_poem mode -> the novel has its own password_hash
--   * author in shared mode   -> the author has a shared_password_hash
--     (guaranteed by CHECK editors_shared_mode_requires_password)
-- Raised as check_violation, like the poems' triggers.

CREATE FUNCTION novels_require_password() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mode password_mode;
BEGIN
  IF NEW.visibility = 'private' AND NEW.password_hash IS NULL THEN
    -- FOR SHARE: a concurrent mode switch on this editor waits for us (and
    -- we for it), so the two checks can't both pass on stale data.
    SELECT password_mode INTO mode FROM editors WHERE id = NEW.editor_id FOR SHARE;
    IF mode IS DISTINCT FROM 'shared' THEN
      RAISE EXCEPTION 'private novel % has no password', NEW.id
        USING ERRCODE = 'check_violation', CONSTRAINT = 'novels_private_requires_password';
    END IF;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER novels_require_password
AFTER INSERT OR UPDATE OF visibility, password_hash, editor_id ON novels
FOR EACH ROW EXECUTE FUNCTION novels_require_password();
--> statement-breakpoint
-- The editor side now checks novels as well as poems: switching to per_poem
-- mode while a private novel has no password of its own is refused.
CREATE OR REPLACE FUNCTION editors_per_poem_requires_poem_passwords() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.password_mode = 'per_poem' AND EXISTS (
    SELECT 1 FROM poems
    WHERE editor_id = NEW.id AND visibility = 'private' AND password_hash IS NULL
  ) THEN
    RAISE EXCEPTION 'editor % has private poems without a password', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'poems_private_requires_password';
  END IF;
  IF NEW.password_mode = 'per_poem' AND EXISTS (
    SELECT 1 FROM novels
    WHERE editor_id = NEW.id AND visibility = 'private' AND password_hash IS NULL
  ) THEN
    RAISE EXCEPTION 'editor % has private novels without a password', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'novels_private_requires_password';
  END IF;
  RETURN NULL;
END $$;
