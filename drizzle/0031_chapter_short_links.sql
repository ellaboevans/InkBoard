ALTER TABLE "short_links" ALTER COLUMN "poem_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "short_links" ADD COLUMN "chapter_id" uuid;--> statement-breakpoint
ALTER TABLE "short_links" ADD CONSTRAINT "short_links_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "short_links_chapter_key" ON "short_links" USING btree ("chapter_id");--> statement-breakpoint
ALTER TABLE "short_links" ADD CONSTRAINT "short_links_one_target" CHECK (("short_links"."poem_id" IS NULL) <> ("short_links"."chapter_id" IS NULL));