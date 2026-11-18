-- "New chapter" notifications (docs/PLAN.md, Phase 24) announce a chapter
-- only on its first publish. Chapters published before they existed were
-- never announced, and mustn't be when a writer unpublishes and publishes one
-- again: mark every chapter ever published as already announced, like
-- 0018_notified_at_backfill.sql did for poems.
UPDATE chapters SET notified_at = published_at WHERE published_at IS NOT NULL AND notified_at IS NULL;
