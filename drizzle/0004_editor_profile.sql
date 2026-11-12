ALTER TABLE "editors" ADD COLUMN "tagline" text;--> statement-breakpoint
ALTER TABLE "editors" ADD COLUMN "avatar" text;--> statement-breakpoint
ALTER TABLE "editors" ADD COLUMN "links" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "editors" ADD COLUMN "pinned_poem_id" uuid;--> statement-breakpoint
ALTER TABLE "editors" ADD CONSTRAINT "editors_pinned_poem_id_poems_id_fk" FOREIGN KEY ("pinned_poem_id") REFERENCES "public"."poems"("id") ON DELETE set null ON UPDATE no action;