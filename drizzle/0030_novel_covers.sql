ALTER TABLE "novels" ADD COLUMN "cover_key" text;--> statement-breakpoint
ALTER TABLE "novels" ADD CONSTRAINT "novels_cover_key_unique" UNIQUE("cover_key");