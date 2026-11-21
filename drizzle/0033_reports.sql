CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poem_id" uuid,
	"novel_id" uuid,
	"chapter_id" uuid,
	"editor_id" uuid,
	"reason" text NOT NULL,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_one_target" CHECK (num_nonnulls("reports"."poem_id", "reports"."novel_id", "reports"."chapter_id", "reports"."editor_id") = 1),
	CONSTRAINT "reports_reason" CHECK ("reports"."reason" IN ('spam', 'harassment', 'sexual-violent', 'copied', 'personal-info', 'other')),
	CONSTRAINT "reports_details_length" CHECK (char_length("reports"."details") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_poem_id_poems_id_fk" FOREIGN KEY ("poem_id") REFERENCES "public"."poems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_editor_id_editors_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."editors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_poem_idx" ON "reports" USING btree ("poem_id");--> statement-breakpoint
CREATE INDEX "reports_novel_idx" ON "reports" USING btree ("novel_id");--> statement-breakpoint
CREATE INDEX "reports_chapter_idx" ON "reports" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "reports_editor_idx" ON "reports" USING btree ("editor_id");--> statement-breakpoint
CREATE INDEX "reports_created_idx" ON "reports" USING btree ("created_at");