-- Phase 18: poems already on the board count as announced, so a save after
-- this deploy can never announce them (a poem is announced at most once).
UPDATE "poems" SET "notified_at" = "published_at" WHERE "published_at" IS NOT NULL AND "notified_at" IS NULL;
