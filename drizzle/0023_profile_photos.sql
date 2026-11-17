ALTER TABLE "editors" ADD COLUMN "photo_key" text;--> statement-breakpoint
ALTER TABLE "editors" ADD CONSTRAINT "editors_photo_key_unique" UNIQUE("photo_key");