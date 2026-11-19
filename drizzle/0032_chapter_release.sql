ALTER TABLE "chapters" ADD COLUMN "release_at" timestamp with time zone;--> statement-breakpoint
-- Phase 28: every chapter published before scheduling existed was released when it was first published.
UPDATE "chapters" SET "release_at" = COALESCE("published_at", "created_at") WHERE "status" = 'published';--> statement-breakpoint
-- Their notification chance has passed (announced at publish, or never, e.g. published while the novel was private):
-- settle it as never to be sent ('-infinity', which announceChapter refuses), so the release step
-- (claimReleasedChapters) only ever sees scheduled releases.
UPDATE "chapters" SET "notified_at" = '-infinity' WHERE "status" = 'published' AND "notified_at" IS NULL;--> statement-breakpoint
CREATE INDEX "chapters_status_release_idx" ON "chapters" USING btree ("status","release_at");--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_release_when_published" CHECK (("chapters"."status" = 'published') = ("chapters"."release_at" IS NOT NULL));