ALTER TABLE "push_deliveries" ALTER COLUMN "poem_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD COLUMN "chapter_id" uuid;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_deliveries_chapter_idx" ON "push_deliveries" USING btree ("chapter_id");--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_one_target_check" CHECK (("push_deliveries"."poem_id" IS NULL) <> ("push_deliveries"."chapter_id" IS NULL));