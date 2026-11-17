CREATE TYPE "public"."novel_status" AS ENUM('ongoing', 'complete');--> statement-breakpoint
CREATE TABLE "chapter_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"saved_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"novel_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"slug" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	"status" "poem_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"word_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"editor_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"blurb" text,
	"language" text,
	"status" "novel_status" DEFAULT 'ongoing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chapter_revisions" ADD CONSTRAINT "chapter_revisions_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_novel_id_novels_id_fk" FOREIGN KEY ("novel_id") REFERENCES "public"."novels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novels" ADD CONSTRAINT "novels_editor_id_editors_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."editors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chapter_revisions_chapter_saved_idx" ON "chapter_revisions" USING btree ("chapter_id","saved_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_novel_slug_key" ON "chapters" USING btree ("novel_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_novel_position_key" ON "chapters" USING btree ("novel_id","position");--> statement-breakpoint
CREATE INDEX "chapters_status_published_idx" ON "chapters" USING btree ("status","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "novels_editor_slug_key" ON "novels" USING btree ("editor_id","slug");